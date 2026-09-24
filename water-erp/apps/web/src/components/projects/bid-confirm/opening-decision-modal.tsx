'use client';

import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import type {
  BidProjectRef,
  BidWorkspaceExpert,
  BidWorkspaceSupplier,
  OpeningDecisionNotifyPayload,
} from '@/lib/api/bid';

/**
 * 开标决策通知弹窗（按时开标 / 延时开标按钮触发）：
 * 决策前配置通知——供应商（站内=供应商门户消息中心 + 短信=主联系人手机）与
 * 专家（短信=档案联系电话）。渠道行 / 标题+正文编辑沿用「供应商通知 / 专家通知」
 * （供应商选取·确认通知步骤）的既定设计；文案支持占位符 {供应商名称} / {专家姓名}。
 * 决策执行与发送由父级（开标确认面板）注入：executeDecision 先行（延时=改时间，
 * 按时=startOpening），成功后 sendNotify；通知失败由父级回落强制重试壳，本弹窗不重试。
 */

export type OpeningDecisionMode = 'ontime' | 'delay';

type Props = {
  isOpen: boolean;
  mode: OpeningDecisionMode;
  bidProject: BidProjectRef | null;
  /** workspace 名册供应商（通知对象） */
  suppliers: BidWorkspaceSupplier[];
  /** workspace 专家组（排除已拒绝由后端把关，前端全量展示） */
  experts: BidWorkspaceExpert[];
  busy?: boolean;
  /** 执行决策：'ok' 继续发通知；'failed' 中止（清单拦截/失败提示已由父级呈现），本弹窗关闭 */
  executeDecision: (openTimeIso: string) => Promise<'ok' | 'failed'>;
  /** 发送通知：失败不抛错（父级回落强制重试壳） */
  sendNotify: (payload: OpeningDecisionNotifyPayload) => Promise<void>;
  /** 决策+通知链路收尾（父级关弹窗 + 重载） */
  onComplete: () => void;
  onClose: () => void;
};

/* ── 日期工具（与 bid-confirm-panel 同款口径） ── */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtCn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SIGNATURE = '四川省水利发展集团有限公司';

function buildSupplierTemplate(bp: BidProjectRef, mode: OpeningDecisionMode, fmt: string) {
  return mode === 'ontime'
    ? {
        title: `开标通知：${bp.name}`,
        body: `{供应商名称} 您好！\n\n项目 ${bp.projectCode}（${bp.name}）将按计划于 ${fmt} 开标，请您安排代表准时出席，具体开标安排请以供应商门户最新通知为准。\n\n${SIGNATURE}`,
      }
    : {
        title: `开标时间变更：${bp.name}`,
        body: `{供应商名称} 您好！\n\n项目 ${bp.projectCode}（${bp.name}）开标时间调整至 ${fmt}，请您以最新时间为准安排出席；投标截止时间不变。\n\n${SIGNATURE}`,
      };
}
function buildExpertTemplate(bp: BidProjectRef, mode: OpeningDecisionMode, fmt: string) {
  return mode === 'ontime'
    ? {
        title: `评审出席提醒：${bp.name}`,
        body: `{专家姓名} 老师：\n\n项目 ${bp.projectCode}（${bp.name}）将按计划于 ${fmt} 开标，请您提前安排行程，准时出席评审工作。\n\n${SIGNATURE}`,
      }
    : {
        title: `开标时间变更：${bp.name}`,
        body: `{专家姓名} 老师：\n\n项目 ${bp.projectCode}（${bp.name}）开标时间调整至 ${fmt}，请以最新时间为准安排出席评审。\n\n${SIGNATURE}`,
      };
}

export function OpeningDecisionModal({
  isOpen,
  mode,
  bidProject,
  suppliers,
  experts,
  busy,
  executeDecision,
  sendNotify,
  onComplete,
  onClose,
}: Props) {
  const [delayTime, setDelayTime] = useState('');
  const [supplierChannels, setSupplierChannels] = useState<string[]>(['in_app', 'sms']);
  const [supplierTitle, setSupplierTitle] = useState('');
  const [supplierBody, setSupplierBody] = useState('');
  const [supplierDirty, setSupplierDirty] = useState(false);
  const [expertChannels, setExpertChannels] = useState<string[]>(['sms']);
  const [expertTitle, setExpertTitle] = useState('');
  const [expertBody, setExpertBody] = useState('');
  const [expertDirty, setExpertDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* 打开即按模式+开标时间预填默认文案；关闭复位（模态打开/关闭重置惯例） */
  /* eslint-disable react-hooks/set-state-in-effect -- 模态打开时按 props 派生初始文案，符合面板同款惯例 */
  useEffect(() => {
    if (isOpen && bidProject) {
      setDelayTime(toLocalInput(bidProject.openTime));
      const tpl = buildSupplierTemplate(bidProject, mode, fmtCn(bidProject.openTime));
      setSupplierTitle(tpl.title);
      setSupplierBody(tpl.body);
      setSupplierDirty(false);
      const etpl = buildExpertTemplate(bidProject, mode, fmtCn(bidProject.openTime));
      setExpertTitle(etpl.title);
      setExpertBody(etpl.body);
      setExpertDirty(false);
      setSupplierChannels(['in_app', 'sms']);
      setExpertChannels(['sms']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, bidProject?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen || !bidProject) return null;

  const toggle = (list: string[], key: string, set: (v: string[]) => void) =>
    set(list.includes(key) ? list.filter((c) => c !== key) : [...list, key]);

  /* 延时模式改时间：未手改过的文案随新时间重生成（派生态在事件处更新，不用 effect） */
  const handleDelayTimeChange = (value: string) => {
    setDelayTime(value);
    if (!value || Number.isNaN(new Date(value).getTime())) return;
    const iso = new Date(value).toISOString();
    if (!supplierDirty) {
      const tpl = buildSupplierTemplate(bidProject, mode, fmtCn(iso));
      setSupplierTitle(tpl.title);
      setSupplierBody(tpl.body);
    }
    if (!expertDirty) {
      const tpl = buildExpertTemplate(bidProject, mode, fmtCn(iso));
      setExpertTitle(tpl.title);
      setExpertBody(tpl.body);
    }
  };

  const supplierNames = suppliers.map((s) => s.supplierName);
  const expertChips = experts.map((e) => ({ name: e.expertName, role: e.expertRole }));

  const handleConfirm = async () => {
    if (mode === 'delay' && !delayTime) {
      toast.error('请先选择新的开标时间');
      return;
    }
    if (supplierChannels.length > 0 && !supplierBody.trim()) {
      toast.error('请填写供应商通知内容');
      return;
    }
    if (expertChannels.length > 0 && !expertBody.trim()) {
      toast.error('请填写专家短信通知内容');
      return;
    }
    setSubmitting(true);
    try {
      const openTimeIso = mode === 'delay' ? new Date(delayTime).toISOString() : bidProject.openTime;
      const r = await executeDecision(openTimeIso);
      if (r !== 'ok') {
        // 决策被拦（清单弹窗/错误提示已由父级呈现）——收起配置弹窗
        onClose();
        return;
      }
      await sendNotify({
        decision: mode === 'ontime' ? 'ONTIME' : 'DELAY',
        openTime: openTimeIso,
        notifySuppliers: supplierChannels.length > 0,
        supplierChannels,
        supplierTitle,
        supplierContent: supplierBody,
        notifyExperts: expertChannels.length > 0,
        expertChannels,
        expertTitle,
        expertContent: expertBody,
      });
      onComplete();
    } finally {
      setSubmitting(false);
    }
  };

  const working = submitting || busy;

  return (
    <Modal
      open={isOpen}
      onClose={working ? () => {} : onClose}
      size="lg"
      title={mode === 'ontime' ? '按时开标确认' : '延时开标确认'}
      description={
        <span>
          <span className="font-mono">{bidProject.projectCode}</span> · {bidProject.name}
        </span>
      }
      footer={
        <div className="neu-btn-group">
          <button type="button" onClick={onClose} disabled={working} className="neu-btn-soft">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={working || (mode === 'delay' && !delayTime)}
            className="neu-btn-primary gap-1.5"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : mode === 'ontime' ? <CheckCircle2 size={13} /> : <CalendarClock size={13} />}
            {mode === 'ontime' ? '确认开标并通知' : '确认延时并通知'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── 决策信息 ── */}
        <div className="wb-note flex flex-wrap items-center gap-3 px-3.5 py-3 text-xs">
          <CalendarClock size={14} className="shrink-0 text-[var(--accent)]" />
          {mode === 'ontime' ? (
            <>
              <span className="text-[var(--muted-foreground)]">计划开标时间</span>
              <span className="font-semibold tabular-nums text-[var(--foreground)]">{fmtDateTime(bidProject.openTime)}</span>
              <span className="text-[var(--muted-foreground)]">·</span>
              <span className="text-[var(--muted-foreground)]">截标</span>
              <span className="font-semibold tabular-nums text-[var(--foreground)]">{fmtDateTime(bidProject.deadline)}</span>
            </>
          ) : (
            <>
              <span className="text-[var(--muted-foreground)]">新的开标时间</span>
              <input
                type="datetime-local"
                className="workbench-input workbench-input-sm !w-auto"
                value={delayTime}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(e) => handleDelayTimeChange(e.target.value)}
              />
              <span className="rounded-full bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--warning)]">
                截标已固化，仅推迟开标
              </span>
              <span className="text-[var(--muted-foreground)]">原 {fmtDateTime(bidProject.openTime)}</span>
            </>
          )}
          <span className="ml-auto shrink-0 text-[var(--muted-foreground)]">
            供应商 {supplierNames.length} 家 · 专家 {expertChips.length} 人
          </span>
        </div>

        {/* ── 供应商通知（渠道行 + 对象 + 站内/短信文案，沿用供应商通知设计） ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
            <Users size={13} className="text-[var(--accent)]" />
            供应商通知
            <span className="ml-1 rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
              {supplierNames.length} 家
            </span>
          </div>

          <div className="notify-channel-row">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
              <Send size={12} className="text-[var(--accent)]" />
              通知渠道
            </span>
            <div className="notify-channel-group">
              <button
                type="button"
                onClick={() => toggle(supplierChannels, 'in_app', setSupplierChannels)}
                className={`neu-tab flex-row items-center gap-1.5 px-3 py-1.5 ${supplierChannels.includes('in_app') ? 'is-active' : ''}`}
              >
                <MessageSquare size={13} />
                <span className="text-[11px] font-semibold">站内（供应商门户）</span>
              </button>
              <button
                type="button"
                onClick={() => toggle(supplierChannels, 'sms', setSupplierChannels)}
                className={`neu-tab flex-row items-center gap-1.5 px-3 py-1.5 ${supplierChannels.includes('sms') ? 'is-active' : ''}`}
              >
                <Bell size={13} />
                <span className="text-[11px] font-semibold">短信（主联系人手机）</span>
              </button>
            </div>
            {supplierChannels.length === 0 && (
              <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">未选择渠道，将不通知供应商</span>
            )}
          </div>

          {/* 通知对象 chips */}
          {supplierNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {supplierNames.map((n, i) => (
                <span key={`${n}-${i}`} className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                  {n}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--muted-foreground)]">名册内暂无供应商，将不发送供应商通知。</p>
          )}

          {/* 站内通知 / 短信通知（内容一致） */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
              <MessageSquare size={11} />
              <Bell size={11} />
              <span>站内通知 / 短信通知</span>
            </div>
            <input
              value={supplierTitle}
              onChange={(e) => { setSupplierTitle(e.target.value); setSupplierDirty(true); }}
              placeholder="通知标题"
              className="workbench-input w-full text-xs !h-9"
            />
            <textarea
              value={supplierBody}
              onChange={(e) => { setSupplierBody(e.target.value); setSupplierDirty(true); }}
              rows={7}
              className="neu-input w-full resize-y text-xs leading-relaxed"
            />
            <p className="text-[11px] text-[var(--muted-foreground)]">
              短信发送至各供应商主联系人手机 · 站内信送达供应商门户「消息中心」· 文案支持{' '}
              <span className="font-mono text-[var(--accent)]">{'{供应商名称}'}</span> 占位（发送时逐家替换）
            </p>
          </div>
        </section>

        <hr className="wb-section-rule" />

        {/* ── 专家通知（短信到档案联系电话，沿用专家通知设计） ── */}
        <section className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
            <UserCheck size={13} className="text-[var(--accent)]" />
            专家通知
            <span className="ml-1 rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
              {expertChips.length} 人
            </span>
          </div>

          <div className="notify-channel-row">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
              <Send size={12} className="text-[var(--accent)]" />
              通知渠道
            </span>
            <div className="notify-channel-group">
              <button
                type="button"
                onClick={() => toggle(expertChannels, 'sms', setExpertChannels)}
                className={`neu-tab flex-row items-center gap-1.5 px-3 py-1.5 ${expertChannels.includes('sms') ? 'is-active' : ''}`}
              >
                <Bell size={13} />
                <span className="text-[11px] font-semibold">短信（专家联系电话）</span>
              </button>
            </div>
            {expertChannels.length === 0 && (
              <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">未选择渠道，将不通知专家</span>
            )}
          </div>

          {/* 通知对象 chips（正选/候补标注） */}
          {expertChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {expertChips.map((e, i) => (
                <span key={`${e.name}-${i}`} className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                  {e.name}
                  <span className="ml-1 text-[10px] font-normal text-[var(--muted-foreground)]">{e.role}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--muted-foreground)]">本项目暂无评标专家，将不发送专家通知。</p>
          )}

          {/* 短信通知（专家联系电话） */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
              <Bell size={11} />
              <span>短信通知（专家联系电话）</span>
            </div>
            <input
              value={expertTitle}
              onChange={(e) => { setExpertTitle(e.target.value); setExpertDirty(true); }}
              placeholder="通知标题"
              className="workbench-input w-full text-xs !h-9"
            />
            <textarea
              value={expertBody}
              onChange={(e) => { setExpertBody(e.target.value); setExpertDirty(true); }}
              rows={5}
              className="neu-input w-full resize-y text-xs leading-relaxed"
            />
            <p className="text-[11px] text-[var(--muted-foreground)]">
              短信发送至专家档案联系电话 · 文案支持{' '}
              <span className="font-mono text-[var(--accent)]">{'{专家姓名}'}</span> 占位（发送时逐人替换）
            </p>
          </div>
        </section>
      </div>
    </Modal>
  );
}
