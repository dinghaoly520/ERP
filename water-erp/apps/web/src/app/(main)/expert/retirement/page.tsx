'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getRetireCandidates, confirmRetire, ignoreRetirementWarning } from '@/lib/api/expert';
import { Modal, StatusBadge } from '@/components/workbench';
import { AlertTriangle, Check, RefreshCw, UserX, FileText } from 'lucide-react';
import type { WorkbenchTone } from '@water-erp/shared';

const SPECIALTY_TONES: WorkbenchTone[] = ['blue', 'cyan', 'green', 'orange', 'red', 'purple'];
function specialtyTone(s: string): WorkbenchTone {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return SPECIALTY_TONES[Math.abs(hash) % SPECIALTY_TONES.length];
}

export default function RetirementPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  // 每个候选独立的退库原因
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // 退库二次确认
  const [pendingRetire, setPendingRetire] = useState<{ id: string; name: string; reason: string } | null>(null);
  const [retiring, setRetiring] = useState(false);

  const load = async () => {
    setLoading(true); setErrored(false);
    try { setCandidates(await getRetireCandidates()); }
    catch (e: any) { setErrored(true); toast.error(e?.message || '加载退库候选失败'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openRetire = (id: string, name: string, reason: string) => {
    if (!reason.trim()) { toast.error('请输入退库原因'); return; }
    setPendingRetire({ id, name, reason: reason.trim() });
  };

  const doRetire = async () => {
    if (!pendingRetire) return;
    const { id, name, reason } = pendingRetire;
    setRetiring(true);
    try {
      await confirmRetire(id, reason);
      toast.success(`${name} 已退库`);
      setReasons(prev => { const n = { ...prev }; delete n[id]; return n; });
      setPendingRetire(null);
      load();
    } catch (e: any) { toast.error(e?.message || '退库失败'); }
    setRetiring(false);
  };

  // KPI 派生：连续 E 级 / 长期无分配
  const evalWarned = candidates.filter(c => c.reason.includes('E 级')).length;
  const idleWarned = candidates.length - evalWarned;

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UserX size={17} /></div>
            <div><div className="page-hero__title">退库管理</div><div className="page-hero__sub">扫描连续 E 级评价或 12 个月无分配的专家，人工复核确认退库</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs" aria-label="刷新"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回专家库</button>
          </div>
        </div>
        <div className="page-hero__divider">
          <div className="grid grid-cols-3 gap-2 items-stretch">
            <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">预警候选</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--warning)]">{loading ? '—' : candidates.length}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">待人工复核</span>
            </div>
            <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">连续 E 级</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--danger)]">{loading ? '—' : evalWarned}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">履职评价预警</span>
            </div>
            <div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">长期无分配</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{loading ? '—' : idleWarned}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">近 12 个月未参与评审</span>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map(i => <div key={i} className="neu-card-static !rounded-2xl h-28" />)}
        </div>
      ) : errored ? (
        <div className="neu-table-card py-16 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
            <p className="text-sm font-semibold text-[var(--danger)]">退库候选加载失败</p>
            <button onClick={load} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
          </div>
        </div>
      ) : candidates.length === 0 ? (
        <div className="neu-table-card py-16 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><Check size={22} className="text-[var(--success)]" /></div>
            <p className="text-sm text-[var(--muted-foreground)]">当前无退库候选专家</p>
            <p className="text-[11px] text-[var(--muted-foreground)]/60">所有专家履职正常且近期有分配记录</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map(c => (
            <div key={c.userId} className="neu-card-static !rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{c.displayName[0]}</div>
                    <span className="text-sm font-bold text-[var(--foreground)]">{c.displayName}</span>
                    {c.specialty && <StatusBadge tone={specialtyTone(c.specialty)}>{c.specialty}</StatusBadge>}
                    <AlertTriangle size={14} className="text-[var(--warning)]" />
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1.5 ml-[42px]">预警原因：{c.reason}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      try { await ignoreRetirementWarning(c.userId); toast.success(`${c.displayName} 本轮预警已忽略（90天）`); load(); }
                      catch (e: any) { toast.error(e?.message || '操作失败'); }
                    }}
                    className="neu-btn-xs"
                    title="90 天内不再扫描该专家"
                  >
                    忽略本轮
                  </button>
                  <button
                    onClick={() => openRetire(c.userId, c.displayName, reasons[c.userId] || '')}
                    disabled={!(reasons[c.userId]?.trim()) || retiring}
                    className="neu-btn-soft is-danger shrink-0"
                  >
                    确认退库
                  </button>
                </div>
              </div>
              <input
                value={reasons[c.userId] || ''}
                onChange={e => setReasons(prev => ({ ...prev, [c.userId]: e.target.value }))}
                placeholder="填写退库原因（如：连续两次E级评价、长期未参与评审…）"
                className="neu-input text-sm w-full"
              />
            </div>
          ))}
        </div>
      )}

      {/* ══════ 退库二次确认（Modal 表单范式） ══════ */}
      {pendingRetire && (
        <Modal
          open
          onClose={() => setPendingRetire(null)}
          closeOnBackdrop={!retiring}
          closeOnEsc={!retiring}
          title={
            <span className="flex items-center gap-2">
              <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]"><UserX size={14} strokeWidth={1.9} className="text-[var(--danger)]" /></span>
              确认退库
            </span>
          }
          description={<span>专家 <span className="font-semibold text-[color:var(--foreground)]">{pendingRetire.name}</span></span>}
          size="sm"
          footer={
            <>
              <button type="button" onClick={() => setPendingRetire(null)} disabled={retiring} className="neu-btn-soft !h-9 !text-xs">取消</button>
              <button type="button" onClick={doRetire} disabled={retiring} className="neu-btn-soft is-danger !h-9 !text-xs">{retiring ? '处理中…' : '确认退库'}</button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted-foreground)]">退库原因</span>
              <div className="neu-pre flex items-center gap-2.5 rounded-[10px] px-3 py-2.5">
                <FileText size={13} strokeWidth={1.9} className="shrink-0 text-[color:var(--muted-foreground)]" />
                <span className="flex-1 text-xs leading-5 text-[color:var(--foreground)]">{pendingRetire.reason}</span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2.5">
              <AlertTriangle size={13} strokeWidth={1.9} className="mt-0.5 shrink-0 text-[var(--warning)]" />
              <span className="text-xs leading-5 text-[color:var(--muted-foreground)]">
                退库后该专家将<strong className="text-[color:var(--foreground)]">不再参与新的评审抽取</strong>，退库状态保留；如需恢复可重新启用。
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
