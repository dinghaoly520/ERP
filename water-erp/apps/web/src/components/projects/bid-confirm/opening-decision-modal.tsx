'use client';

import { useEffect, useState } from 'react';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
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
 * 专家（短信=档案联系电话）。文案为固定语句+关键词设计（2026-11-18 用户裁定，对齐
 * 供应商邀请通知 2026-10-27 口径）：不可编辑，占位符 {供应商名称} / {专家姓名} 发送时替换。
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
  /** 执行决策：'ok' 继续发通知；'checklist' = 清单拦截（收起后经 onBlocked 呈现）；
   *  'failed' 中止（错误提示已由父级呈现），两种情况本弹窗都收起且不发通知 */
  executeDecision: (openTimeIso: string) => Promise<'ok' | 'failed' | 'checklist'>;
  /** 发送通知：失败不抛错（父级回落强制重试壳） */
  sendNotify: (payload: OpeningDecisionNotifyPayload) => Promise<void>;
  /** 决策+通知链路收尾（父级关弹窗 + 重载） */
  onComplete: () => void;
  /** 决策被清单拦截：弹窗收起后同批调用（避免双 Modal 并存） */
  onBlocked?: () => void;
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

/** 延时开标后的新截止（= 新开标时刻 − 截标间隔常量；align 口径与后端 opening-deadline.util 同源） */
function delayDeadlineIso(openTimeIso: string): string {
  return new Date(new Date(openTimeIso).getTime() - BID_DEADLINE_BEFORE_OPENING_MS).toISOString();
}

// 正文不带公司落款（2026-11-10 用户裁定）：短信通道发送时自动前置【四川省水利发展集团】签名，
// 正文落款冗余且多耗分段字数——供应商/专家模板一律不附
function buildSupplierTemplate(
  bp: BidProjectRef,
  mode: OpeningDecisionMode,
  fmt: string,
  opts?: { deadlineFmt?: string },
) {
  // 供应商无需到场（2026-11-10 用户裁定）：线上解密即可，文案只请关注开标动态，不出现「出席」
  // 延时截止口径（2026-11-18 用户裁定，推翻 frozen 分档）：截标恒随新开标重算（开标前 10 分钟），
  // 文案恒告知新截止时间
  if (mode === 'ontime') {
    return {
      title: `开标通知：${bp.name}`,
      body: `{供应商名称} 您好！\n\n项目 ${bp.projectCode}（${bp.name}）将按计划于 ${fmt} 开标，请及时关注供应商门户开标动态与相关通知。`,
    };
  }
  return {
    title: `开标时间变更：${bp.name}`,
    body: `{供应商名称} 您好！\n\n项目 ${bp.projectCode}（${bp.name}）开标时间调整至 ${fmt}，投标截止时间相应调整至 ${opts?.deadlineFmt ?? ''}，请以最新时间为准关注开标动态。`,
  };
}
function buildExpertTemplate(bp: BidProjectRef, mode: OpeningDecisionMode, fmt: string) {
  // 专家短信不透露项目名称（2026-11-10 用户裁定）：名称只进 title（短信不携带标题），正文仅编号
  return mode === 'ontime'
    ? {
        title: `评审出席提醒：${bp.name}`,
        body: `{专家姓名} 专家：\n\n项目 ${bp.projectCode} 将按计划于 ${fmt} 开标，请您提前安排行程，准时出席评审工作。`,
      }
    : {
        title: `开标时间变更：${bp.name}`,
        body: `{专家姓名} 专家：\n\n项目 ${bp.projectCode} 开标时间调整至 ${fmt}，请以最新时间为准安排出席评审。`,
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
  onBlocked,
  onClose,
}: Props) {
  const [delayTime, setDelayTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 逐家预览选中（2026-11-18：占位替换后的实际内容预览，参考专家抽取通知步设计） */
  const [activeSupplierIdx, setActiveSupplierIdx] = useState(0);
  const [activeExpertIdx, setActiveExpertIdx] = useState(0);

  /* 打开即按模式+开标时间预填默认文案；关闭复位（模态打开/关闭重置惯例） */
  /* eslint-disable react-hooks/set-state-in-effect -- 模态打开时按 props 派生初始文案，符合面板同款惯例 */
  useEffect(() => {
    if (isOpen && bidProject) {
      setDelayTime(toLocalInput(bidProject.openTime));
      setActiveSupplierIdx(0);
      setActiveExpertIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, bidProject?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen || !bidProject) return null;

  /* 延时模式改时间：固定文案随新时间在渲染处派生（2026-11-18 起文案不可编辑） */
  const handleDelayTimeChange = (value: string) => setDelayTime(value);

  /* 固定文案（2026-11-18 用户裁定：关键词设计——固定语句不可编辑，占位发送时替换）：
      按当前选择的开标时间派生，渲染预览与提交发送同源 */
  const effectiveIso = mode === 'delay' && delayTime && !Number.isNaN(new Date(delayTime).getTime())
    ? new Date(delayTime).toISOString()
    : bidProject.openTime;
  const supplierTpl = buildSupplierTemplate(bidProject, mode, fmtCn(effectiveIso), {
    deadlineFmt: fmtCn(delayDeadlineIso(effectiveIso)),
  });
  const expertTpl = buildExpertTemplate(bidProject, mode, fmtCn(effectiveIso));

  /** 逐家预览（2026-11-18）：占位替换为实际名称，动态值蓝色加粗（同供应商邀请/专家抽取模板形态） */
  const previewSegments = (text: string, highlights: string[]) => {
    const vals = [...new Set(highlights.filter((v) => v && v.length >= 2))].sort((a, b) => b.length - a.length);
    if (vals.length === 0) return [text];
    const escaped = vals.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return text.split(new RegExp(`(${escaped})`, 'g'));
  };

  const supplierNames = suppliers.map((s) => s.supplierName);
  // 已拒绝专家不出现在通知对象中（后端同口径排除 declined）
  const expertChips = experts
    .filter((e) => e.invitationStatus !== 'declined')
    .map((e) => ({ name: e.expertName, role: e.expertRole }));

  const handleConfirm = async () => {
    if (mode === 'delay' && !delayTime) {
      toast.error('请先选择新的开标时间');
      return;
    }
    setSubmitting(true);
    try {
      const openTimeIso = mode === 'delay' ? new Date(delayTime).toISOString() : bidProject.openTime;
      const r = await executeDecision(openTimeIso);
      if (r !== 'ok') {
        // 决策被拦（清单弹窗/错误提示由父级呈现）——先收起配置弹窗；清单拦截
        // 与 onClose 同一批次打开，避免双 Modal 并存
        onClose();
        if (r === 'checklist') onBlocked?.();
        return;
      }
      await sendNotify({
        decision: mode === 'ontime' ? 'ONTIME' : 'DELAY',
        openTime: openTimeIso,
        notifySuppliers: true,
        supplierChannels: ['in_app', 'sms'],
        supplierTitle: supplierTpl.title,
        supplierContent: supplierTpl.body,
        notifyExperts: true,
        expertChannels: ['sms'],
        expertTitle: expertTpl.title,
        expertContent: expertTpl.body,
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
          {bidProject.name} · <span className="font-mono">{bidProject.projectCode}</span>
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
            className="neu-btn-primary is-water gap-1.5"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : mode === 'ontime' ? <CheckCircle2 size={13} /> : <CalendarClock size={13} />}
            {mode === 'ontime' ? '确认开标并通知' : '确认延时并通知'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── 决策信息（2026-11-18 排版优化：延时模式两行——主行选择器+联动 pill，副行原时间+通知对象数） ── */}
        <div className="wb-note px-3.5 py-3 text-xs">
          {mode === 'ontime' ? (
            <div className="flex flex-wrap items-center gap-3">
              <CalendarClock size={14} className="shrink-0 text-[var(--accent)]" />
              <span className="text-[var(--muted-foreground)]">计划开标时间</span>
              <span className="font-semibold tabular-nums text-[var(--foreground)]">{fmtDateTime(bidProject.openTime)}</span>
              <span className="text-[var(--muted-foreground)]">·</span>
              <span className="text-[var(--muted-foreground)]">截标</span>
              <span className="font-semibold tabular-nums text-[var(--foreground)]">{fmtDateTime(bidProject.deadline)}</span>
              <span className="ml-auto shrink-0 text-[var(--muted-foreground)]">
                供应商 {supplierNames.length} 家 · 专家 {expertChips.length} 人
              </span>
            </div>
          ) : (
            /* 单一组件框（2026-11-18 排版收敛）：图标+标签+选择器+原开标 同片强制单行；
               底色与内高光走 globals.css 的 .bc-decision-box（cgzxui 单一 CSS 源） */
            <div className="bc-decision-box flex flex-nowrap items-center gap-2.5 rounded-[12px] px-3.5 py-2">
              <CalendarClock size={14} className="shrink-0 text-[var(--accent)]" />
              <span className="shrink-0 text-xs font-bold text-[var(--foreground)]">新的开标时间</span>
              <input
                type="datetime-local"
                className="workbench-input workbench-input-sm !h-8 !w-auto !border-0 !shadow-none !bg-transparent !px-1.5"
                value={delayTime}
                min={toLocalInput(new Date().toISOString())}
                onChange={(e) => handleDelayTimeChange(e.target.value)}
              />
              <span className="ml-auto min-w-0 shrink-0 truncate text-[11px] tabular-nums text-[var(--muted-foreground)]">
                原开标 <span className="font-semibold text-[var(--foreground)]">{fmtDateTime(bidProject.openTime)}</span>
              </span>
            </div>
          )}
        </div>

        {/* ── 供应商通知（2026-11-18 排版重整：标题行含渠道切换 + 名单 + 单一预览盒——
            删关键词行/模板行与预览的信息重复） ── */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Users size={14} className="shrink-0 text-[var(--accent)]" />
            <span className="text-xs font-bold text-[var(--foreground)]">供应商通知</span>
            <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
              {supplierNames.length} 家
            </span>
          </div>

          {/* 通知对象（点击切换逐家预览） */}
          {supplierNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {supplierNames.map((n, i) => (
                <button
                  key={`${n}-${i}`}
                  type="button"
                  onClick={() => setActiveSupplierIdx(i)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${i === activeSupplierIdx ? 'text-[var(--accent-strong)] ring-1 ring-[color-mix(in_oklch,var(--accent)_35%,transparent)]' : 'text-[var(--foreground)]'}`}
                  style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--muted-foreground)]">名册内暂无供应商，将不发送供应商通知。</p>
          )}

          {/* 发送内容（固定文案逐家替换预览，动态值蓝色加粗） */}
          {supplierNames.length > 0 && (() => {
            const name = supplierNames[Math.min(activeSupplierIdx, supplierNames.length - 1)];
            const body = supplierTpl.body.replace(/\{供应商名称\}/g, name);
            const hl = [name, bidProject.projectCode, bidProject.name, fmtCn(effectiveIso), ...(mode === 'delay' ? [fmtCn(delayDeadlineIso(effectiveIso))] : [])].filter(Boolean) as string[];
            return (
              <div className="bc-notice-preview rounded-[12px] px-3.5 py-3">
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]">
                  {previewSegments(body, hl).map((seg, i) =>
                    hl.includes(seg) ? <b key={i} className="font-semibold text-[var(--accent-strong)]">{seg}</b> : <span key={i}>{seg}</span>)}
                </div>
              </div>
            );
          })()}
        </section>

        <hr className="wb-section-rule" />

        {/* ── 专家通知（同款排版：标题行含渠道 + 名单 + 预览盒） ── */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <UserCheck size={14} className="shrink-0 text-[var(--accent)]" />
            <span className="text-xs font-bold text-[var(--foreground)]">专家通知</span>
            <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
              {expertChips.length} 人
            </span>
          </div>

          {/* 通知对象（点击切换逐人预览；已拒绝专家后端同口径排除） */}
          {expertChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {expertChips.map((e, i) => (
                <button
                  key={`${e.name}-${i}`}
                  type="button"
                  onClick={() => setActiveExpertIdx(i)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${i === activeExpertIdx ? 'text-[var(--accent-strong)] ring-1 ring-[color-mix(in_oklch,var(--accent)_35%,transparent)]' : 'text-[var(--foreground)]'}`}
                  style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}
                >
                  {e.name}
                  <span className="ml-1 text-[10px] font-normal text-[var(--muted-foreground)]">{e.role}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {experts.length > 0 ? '专家均已拒绝出席，将不发送专家通知。' : '本项目暂无评标专家，将不发送专家通知。'}
            </p>
          )}

          {/* 发送内容（固定文案逐人替换预览） */}
          {expertChips.length > 0 && (() => {
            const name = expertChips[Math.min(activeExpertIdx, expertChips.length - 1)].name;
            const body = expertTpl.body.replace(/\{专家姓名\}/g, name);
            const hl = [name, bidProject.projectCode, fmtCn(effectiveIso)].filter(Boolean) as string[];
            return (
              <div className="bc-notice-preview rounded-[12px] px-3.5 py-3">
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]">
                  {previewSegments(body, hl).map((seg, i) =>
                    hl.includes(seg) ? <b key={i} className="font-semibold text-[var(--accent-strong)]">{seg}</b> : <span key={i}>{seg}</span>)}
                </div>
              </div>
            );
          })()}
        </section>
      </div>
    </Modal>
  );
}
