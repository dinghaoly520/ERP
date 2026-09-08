'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, CalendarClock, Loader2, MessageSquare, Phone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import {
  cancelSupplierNudge,
  getSupplierNudgeStatus,
  scheduleSupplierNudge,
  sendSupplierNudge,
  type SupplierNudgeMessage,
  type SupplierNudgeStatus,
} from '@/lib/api/bid';
import { generateNotificationContent } from '@/lib/api/supplier';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  bidProjectId: string;
  onChanged?: () => void;
};

const CHANNELS = [
  { key: 'in_app', label: '站内通知', Icon: MessageSquare },
  { key: 'sms', label: '短信通知', Icon: Bell },
  { key: 'phone', label: '电话通知', Icon: Phone },
] as const;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 催促"已回执参加但未投递"供应商：打开即用 AI 逐家生成文案（含对应供应商名称），
 * 通知渠道默认 3 种；可人工立即发送或定时（开标前 24h）发送，人工/自动共用一次额度。
 * 距开标不足 24 小时后催促通道整体关闭（立即/定时均不可，2026-09-01 拍板，后端同步闸门）。
 */
export function NudgeUnsubmittedModal({ isOpen, onClose, project, bidProjectId, onChanged }: Props) {
  const [status, setStatus] = useState<SupplierNudgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Record<string, SupplierNudgeMessage>>({});
  const [channels, setChannels] = useState<string[]>(['in_app', 'sms', 'phone']);
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bidProjectId) return;
    setLoading(true);
    try {
      const s = await getSupplierNudgeStatus(bidProjectId);
      setStatus(s);
      if (s.channels?.length) setChannels(s.channels);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载催促状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setMessages({});
      void load();
    } else {
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bidProjectId]);

  const targets = status?.targets ?? [];
  const mode: 'sent' | 'scheduled' | 'editable' =
    status?.status === 'SENT' ? 'sent' : status?.status === 'SCHEDULED' ? 'scheduled' : 'editable';

  // 定时点 = 开标前 24h
  const scheduleAtIso = useMemo(() => {
    if (!status?.openTime) return null;
    return new Date(new Date(status.openTime).getTime() - 24 * 3600 * 1000).toISOString();
  }, [status?.openTime]);
  const scheduleInFuture = !!scheduleAtIso && new Date(scheduleAtIso).getTime() > Date.now();
  // 催促窗口（2026-09-01 拍板）：距开标不足 24h 后催促通道整体关闭——立即发送与定时均不可。
  // openTime 未登记时无从判定窗口，不拦（与后端 assertNudgeWindowOpen 口径一致）
  const windowClosed = !!status?.openTime && !scheduleInFuture;

  const allHaveContent = targets.length > 0 && targets.every((t) => messages[t.supplierId]?.body?.trim());

  const handleAi = async () => {
    if (targets.length === 0) return;
    setAiLoading(true);
    try {
      const names = targets.map((t) => t.name);
      const ids = targets.map((t) => t.supplierId);
      const contractAmount = project?.contractAmount;
      const budgetAmount = project?.budgetAmount;
      const res = await generateNotificationContent({
        projectName: project?.title,
        projectCode: project?.projectCode ?? undefined,
        supplierNames: names,
        supplierIds: ids,
        projectId: project?.id ?? null,
        deadline: status?.openTime ? new Date(status.openTime).toLocaleDateString('zh-CN') : undefined,
        procurementMethod: project?.procurementMethod,
        budgetAmount:
          contractAmount != null
            ? `最高限价 ${Number(contractAmount).toLocaleString('zh-CN')}`
            : budgetAmount
              ? `${Number(budgetAmount).toLocaleString('zh-CN')} 元`
              : undefined,
        requesterDepartment: project?.requesterDepartment,
        projectReason: project?.projectReason,
        supplierRequirements: (project as any)?.supplierRequirements,
        projectOverview: (project as any)?.projectOverview,
        validityDays: 1,
      });
      const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      const next: Record<string, SupplierNudgeMessage> = {};
      for (const t of targets) {
        const link = (res.rsvpTokens || {})[t.supplierId] || '';
        const body = res.body.replace(/\{rsvpLink\}/g, link);
        next[t.supplierId] = {
          title: res.title,
          body: `${t.name} 您好！\n\n${body}\n\n四川省水利发展集团有限公司\n${dateStr}`,
        };
      }
      setMessages(next);
      toast.success('AI 已为每家供应商生成催促通知');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 生成失败');
    } finally {
      setAiLoading(false);
    }
  };

  const requireContent = (): boolean => {
    if (!allHaveContent) {
      toast.error('请先生成催促通知内容');
      return false;
    }
    return true;
  };

  const handleSend = async () => {
    if (windowClosed) {
      toast.error('距开标已不足 24 小时，催促通道已关闭');
      return;
    }
    if (!requireContent()) return;
    setSending(true);
    try {
      const r = await sendSupplierNudge(bidProjectId, { channels, messages });
      toast.success(`已催促 ${r.sent} 家供应商${r.notFound ? `，${r.notFound} 家无关联账户` : ''}`);
      await load();
      onChanged?.();
    } catch (e: any) {
      const code = e?.code;
      if (code === 'NUDGE_ALREADY_SENT') toast.error('该项目已催促过，仅可催促一次');
      else if (code === 'NUDGE_WINDOW_CLOSED') toast.error('距开标已不足 24 小时，催促通道已关闭');
      else toast.error(e?.message || '发送失败');
      await load();
    } finally {
      setSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!requireContent() || !scheduleAtIso) return;
    if (windowClosed) {
      toast.error('距开标已不足 24 小时，催促通道已关闭');
      return;
    }
    setScheduling(true);
    try {
      await scheduleSupplierNudge(bidProjectId, { sendAt: scheduleAtIso, channels, messages });
      toast.success(`已设定开标前 24 小时（${fmt(scheduleAtIso)}）自动催促`);
      await load();
      onChanged?.();
    } catch (e: any) {
      const code = e?.code;
      if (code === 'NUDGE_ALREADY_SENT') toast.error('该项目已催促过，无法再设定时');
      else toast.error(e?.message || '设定定时失败');
      await load();
    } finally {
      setScheduling(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelSupplierNudge(bidProjectId);
      toast.success('已取消定时催促');
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取消失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleChannel = (key: string) =>
    setChannels((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      title="催促未投递供应商"
      description="仅催“已回执参加但尚未投递”的供应商 · 人工/自动共用一次"
      footer={
        mode === 'sent' ? (
          <button type="button" onClick={onClose} className="neu-btn-soft !h-[38px]">关闭</button>
        ) : mode === 'scheduled' ? (
          <div className="neu-btn-group">
            <button type="button" onClick={() => void handleCancel()} disabled={busy} className="neu-btn-soft">取消定时</button>
            <button type="button" onClick={onClose} className="neu-btn-soft">关闭</button>
          </div>
        ) : (
          <div className="neu-btn-group">
            <button type="button" onClick={onClose} className="neu-btn-soft">取消</button>
            <button
              type="button"
              onClick={() => void handleSchedule()}
              disabled={scheduling || sending || !allHaveContent || !scheduleInFuture}
              className="neu-btn-soft gap-1.5"
              title={scheduleInFuture ? '开标前 24 小时自动发送' : '距开标不足 24 小时，催促通道已关闭'}
            >
              {scheduling ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />}
              定时（开标前24h）
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || scheduling || !allHaveContent || channels.length === 0 || windowClosed}
              className="neu-btn-primary gap-1.5"
              title={windowClosed ? '距开标不足 24 小时，催促通道已关闭' : undefined}
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
              立即发送
            </button>
          </div>
        )
      }
    >
      {loading ? (
        <div className="flex min-h-[160px] items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin text-[var(--accent)]" /> 加载催促状态…
        </div>
      ) : mode === 'sent' ? (
        <div className="rounded-[16px] bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-4 py-5 text-center">
          <div className="text-sm font-semibold text-[var(--success)]">本项目已催促过，仅可催促一次</div>
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">发送时间：{fmt(status?.sentAt ?? null)}</div>
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-[16px] bg-[oklch(0.975_0.012_258/0.4)] px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
          当前没有“已回执参加但尚未投递”的供应商，无需催促。
        </div>
      ) : (
        <>
          {/* 目标名单 + 逐家文案 */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                催促对象（已回执·未投递）{targets.length} 家
              </span>
              <button type="button" onClick={() => void handleAi()} disabled={aiLoading || windowClosed} className="neu-btn-xs gap-1" title={windowClosed ? '距开标不足 24 小时，催促通道已关闭' : undefined}>
                {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {aiLoading ? '生成中…' : Object.keys(messages).length ? '重新生成' : 'AI 生成通知'}
              </button>
            </div>
            <div className="space-y-2">
              {targets.map((t, i) => {
                const m = messages[t.supplierId];
                return (
                  <div key={t.supplierId} className="wb-note px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[linear-gradient(135deg,oklch(0.52_0.16_258),oklch(0.45_0.14_258))] text-[9px] font-extrabold text-white tabular-nums">{i + 1}</span>
                      <span className="text-[12px] font-bold text-[var(--foreground)] truncate">{t.name}</span>
                      <span className={`ml-auto text-[10px] font-semibold ${m?.body?.trim() ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>{m?.body?.trim() ? '已生成' : '待生成'}</span>
                    </div>
                    {m?.body && (
                      <textarea
                        value={m.body}
                        onChange={(e) => setMessages((prev) => ({ ...prev, [t.supplierId]: { ...m, body: e.target.value } }))}
                        rows={3}
                        className="workbench-input mt-2 w-full !text-[11px] leading-5"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 渠道 */}
          <div>
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">通知渠道</span>
            <div className="neu-tab-bar inline-flex">
              {CHANNELS.map(({ key, label, Icon }) => {
                const active = channels.includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleChannel(key)} className={`neu-tab text-[11px] gap-1 ${active ? 'is-active' : ''}`}>
                    <Icon size={12} />{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 定时信息 */}
          {mode === 'scheduled' ? (
            <div className="wb-tone-banner wb-tone-banner--info text-xs">
              <CalendarClock size={14} />
              <span className="text-[var(--foreground)]">已设定 <strong className="tabular-nums">{fmt(status?.sendAt ?? null)}</strong>（开标前 24 小时）自动催促</span>
            </div>
          ) : windowClosed ? (
            <div className="wb-tone-banner wb-tone-banner--warning text-[11px] font-semibold">
              <CalendarClock size={13} />
              <span>距开标已不足 24 小时，催促通道已关闭，无法发送催促通知。</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[14px] bg-[oklch(0.975_0.012_258/0.4)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              <CalendarClock size={13} />
              {scheduleInFuture
                ? <span>定时发送将于 <strong className="tabular-nums text-[var(--foreground)]">{fmt(scheduleAtIso)}</strong>（开标前 24 小时）自动触发；若提前手动发送则取消定时。</span>
                : <span>距开标已不足 24 小时，催促通道已关闭，无法发送催促通知。</span>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
