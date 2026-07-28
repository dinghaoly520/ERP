'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X, Calendar, Clock, FileText, ArrowLeft, ShieldCheck, Loader2, Gavel, CheckCircle2, XCircle } from 'lucide-react';
import { getMyInvitation, confirmMyInvitation, declineMyInvitation, type MyInvitation } from '@/lib/api';

const fmt = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: '待确认', tone: 'var(--warning)' },
  confirmed: { label: '已确认参加', tone: 'var(--success)' },
  declined: { label: '已婉拒', tone: 'var(--danger)' },
};

export default function InvitationConfirmPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [inv, setInv] = useState<MyInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setInv(await getMyInvitation(projectId));
    } catch (e: any) {
      setError(e?.message || '加载邀请信息失败');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const doConfirm = async () => {
    setBusy(true);
    try {
      await confirmMyInvitation(projectId);
      toast.success('已确认参加本次评审');
      await load();
    } catch (e: any) {
      toast.error(e?.message || '确认失败');
    }
    setBusy(false);
  };

  const doDecline = async () => {
    if (!confirm('确认婉拒本次评审邀请？婉拒后如需参加请联系采购方。')) return;
    setBusy(true);
    try {
      const res = await declineMyInvitation(projectId);
      toast.success(res.promoted ? '已婉拒，系统已自动递补候补专家' : '已婉拒本次评审邀请');
      await load();
    } catch (e: any) {
      toast.error(e?.message || '操作失败');
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        {/* 标题 */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow">
            <Gavel size={20} strokeWidth={1.6} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--foreground)]">评审邀请确认</h1>
            <p className="text-xs text-[var(--muted-foreground)]">请确认是否参加本次项目的评审工作</p>
          </div>
        </div>

        {loading ? (
          <div className="neu-card-static flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" /> 加载邀请信息...
          </div>
        ) : error ? (
          <div className="neu-card-static space-y-3 py-12 text-center">
            <XCircle size={28} className="mx-auto text-[var(--danger)]" />
            <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
            <div className="flex justify-center gap-2">
              <button onClick={load} className="neu-btn-soft">重试</button>
              <button onClick={() => router.push('/')} className="neu-btn-soft is-info">返回工作台</button>
            </div>
          </div>
        ) : inv ? (
          <>
            {/* 项目信息卡 */}
            <div className="neu-card-static space-y-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[var(--foreground)]">{inv.projectName}</h2>
                    {inv.isExtractionOnly && (
                      <span className="exp-pill shrink-0" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>抽取预演</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">项目编号：{inv.projectCode}</p>
                </div>
                <span className="exp-pill shrink-0" style={{ '--c': 'var(--accent)' } as React.CSSProperties}>
                  {inv.expertRole === '正选' ? '正选专家' : '候补专家'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                  <FileText size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="text-xs text-[var(--muted-foreground)]">采购方式</span>
                  <span className="ml-auto text-xs font-semibold text-[var(--foreground)]">{inv.procurementMethod}</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                  <Calendar size={14} className="shrink-0 text-[var(--accent)]" />
                  <span className="text-xs text-[var(--muted-foreground)]">开标时间</span>
                  <span className="ml-auto text-xs font-semibold text-[var(--foreground)]">{fmt(inv.openTime)}</span>
                </div>
              </div>
            </div>

            {/* 确认状态 / 操作 */}
            {inv.invitationStatus === 'pending' ? (
              <div className="neu-card-static space-y-4 p-5">
                <div className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2.5 text-xs leading-relaxed text-[var(--warning)]">
                  <ShieldCheck size={14} className="mt-px shrink-0" />
                  <span>您已被抽取为本项目评审专家，请尽快确认是否参加。确认后请按时出席评审；如无法参加请婉拒，以便系统递补候补专家。</span>
                </div>
                <div className="flex gap-3">
                  <button onClick={doConfirm} disabled={busy} className="neu-btn-primary is-success flex-1">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={2.5} />}
                    确认参加
                  </button>
                  <button onClick={doDecline} disabled={busy} className="neu-btn-soft is-danger flex-1">
                    <X size={15} strokeWidth={2.5} />
                    婉拒参加
                  </button>
                </div>
              </div>
            ) : inv.invitationStatus === 'confirmed' ? (
              <div className="neu-card-static flex flex-col items-center gap-2 py-10 text-center">
                <CheckCircle2 size={36} className="text-[var(--success)]" />
                <p className="text-base font-bold text-[var(--success)]">您已确认参加本次评审</p>
                <p className="text-xs text-[var(--muted-foreground)]">请按开标时间准时出席评审工作</p>
              </div>
            ) : (
              <div className="neu-card-static flex flex-col items-center gap-2 py-10 text-center">
                <XCircle size={36} className="text-[var(--danger)]" />
                <p className="text-base font-bold text-[var(--danger)]">您已婉拒本次评审邀请</p>
                <p className="text-xs text-[var(--muted-foreground)]">如需参加请联系采购方</p>
              </div>
            )}

            {/* 返回 */}
            <div className="flex items-center justify-between">
              <button onClick={() => router.push('/')} className="neu-btn-soft">
                <ArrowLeft size={14} /> 返回工作台
              </button>
              <span className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                <Clock size={12} /> 当前状态：
                <span className="font-bold" style={{ color: STATUS[inv.invitationStatus]?.tone }}>
                  {STATUS[inv.invitationStatus]?.label || inv.invitationStatus}
                </span>
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
