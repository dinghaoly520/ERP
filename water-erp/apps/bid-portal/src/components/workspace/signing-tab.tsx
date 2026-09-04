'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Copy, FileDown, Fingerprint, HelpCircle, Loader2, PenLine, RefreshCw, Upload, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { EXPERT_ROLE } from '@water-erp/shared';
import {
  generateHandover, generateSignPacket, getReportNotes, getSignPacket, setReportNotes, unregisterSign,
  uploadExpertScan, uploadSignaturePageScan,
  type SignPacketResponse, type SignPacketExpertRow,
} from '@/lib/api/sign-packet';
import { uploadOpeningSignScan, registerOpeningSign } from '@/lib/api/bid';
import SignRegisterDialog from './sign-register-dialog';
import { OpeningSignBlock } from '../opening-hall-sign-block';
import { useBidUser } from '@/hooks/use-bid-user';

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待签', SIGNED: '已签字', REFUSED_DISSENT: '拒绝·有异议', DEEMED_AGREED: '视为同意',
};
const STATUS_TONE: Record<string, string> = {
  PENDING: 'var(--muted-foreground)', SIGNED: 'var(--success)', REFUSED_DISSENT: 'var(--danger)', DEEMED_AGREED: 'var(--warning, #b7791f)',
};

export default function SigningTab({ projectId, stage }: { projectId: string; stage: string }) {
  const [data, setData] = useState<SignPacketResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registering, setRegistering] = useState<SignPacketExpertRow | null>(null);
  // A-151：报告附注编辑弹窗（可选编辑，生成/重新生成签字包时取库内最新）
  const [notesOpen, setNotesOpen] = useState(false);
  // ═══ 批量回传签字扫描件：一次多选 → 文件名智能路由直传 → 结果清单肉眼核对 ═══
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<Array<{ file: string; target: string; status: 'ok' | 'fail' | 'unmatched'; note?: string }> | null>(null);
  const [signRefreshTick, setSignRefreshTick] = useState(0);
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  // L2（2026-08-28）：签字包写操作（生成/扫描回传/登记/撤销/回流包）后端收口 @Roles('bid_host','admin')——
  // leader/staff 只读查看；开标记录签字卡端点为全角色，不受此门控影响
  const me = useBidUser();
  const canHost = me?.role === 'admin' || me?.role === 'bid_host';

  /** 文件名 → 回传目标路由（含专家名/关键词匹配；先到先得，重复与未识别留待单传）。hasPacket=false 时不含主报告页（该端点依赖签字包存在） */
  const routeFiles = (files: File[], experts: SignPacketExpertRow[], hasPacket: boolean) => {
    const taken = new Set<string>();
    const pool = experts.filter((e) => e.role === EXPERT_ROLE.REGULAR); // 候补不参与签字，不进路由候选
    return files.map((f) => {
      const name = f.name.toLowerCase();
      const match = (kw: string) => name.includes(kw);
      let target: { key: string; label: string } | null = null;
      if (!target && (match('主持人') || match('host'))) target = { key: 'host', label: '主持人签字（开标记录）' };
      if (!target && (match('监督人') || match('监督') || match('supervisor'))) target = { key: 'supervisor', label: '监督人签字（开标记录）' };
      if (!target && hasPacket && (match('报告') || match('共签') || match('声明'))) target = { key: 'report', label: '主报告签字页（共签）' };
      if (!target) {
        const expert = pool.find((e) => e.name && name.includes(e.name.toLowerCase()));
        if (expert) target = { key: `expert:${expert.expertId}`, label: `专家·${expert.name}` };
      }
      if (!target) return { file: f.name, target: '', status: 'unmatched' as const, note: '未识别（文件名不含主持人/监督人/报告/专家名）' };
      if (taken.has(target.key)) return { file: f.name, target: '', status: 'unmatched' as const, note: `重复：${target.label} 已有文件` };
      taken.add(target.key);
      return { file: f, target: target.key, label: target.label, status: 'ok' as const };
    });
  };

  const onBatchUpload = async (files: File[]) => {
    if (!files.length || !data) return;
    setBatchBusy(true);
    const routed = routeFiles(files, data.experts ?? [], !!data.packet);
    const results: Array<{ file: string; target: string; status: 'ok' | 'fail' | 'unmatched'; note?: string }> = [];
    let hostRouted = false;
    for (const r of routed) {
      if (r.status !== 'ok') { results.push({ file: String(r.file), target: '', status: 'unmatched', note: r.note }); continue; }
      const f = r.file as File;
      // 链前捕获 + 显式 string：字面量联合的穷尽窄化会把 r 整体窄成 never（含别名窄化），链后不可再碰 r.*
      const label: string = r.label ?? '';
      const targetKey: string = r.target;
      try {
        if (targetKey === 'host') { await uploadOpeningSignScan(projectId, 'host', f); hostRouted = true; }
        else if (targetKey === 'supervisor') { await uploadOpeningSignScan(projectId, 'supervisor', f); }
        else if (targetKey === 'report') { await uploadSignaturePageScan(projectId, f); }
        else if (targetKey.startsWith('expert:')) { await uploadExpertScan(projectId, targetKey.slice(7), f); }
        results.push({ file: f.name, target: label || targetKey, status: 'ok' });
      } catch (e: any) {
        results.push({ file: f.name, target: label || targetKey, status: 'fail', note: e?.message ?? '上传失败' });
      }
    }
    // 开标记录件到齐即自动登记（与签字卡同一口径；登记成败只取决于主持人/监督人项，不连累专家件）
    const openingFail = results.some((x) => (x.target.startsWith('主持人') || x.target.startsWith('监督人')) && x.status === 'fail');
    if (hostRouted && !openingFail) {
      try {
        await registerOpeningSign(projectId);
        results.push({ file: '（系统）', target: '开标记录自动登记', status: 'ok' });
      } catch (e: any) {
        results.push({ file: '（系统）', target: '开标记录自动登记', status: 'fail', note: e?.message ?? '有监督人且未到齐等场景请单独补传' });
      }
    }
    setBatchResult(results);
    setSignRefreshTick((t) => t + 1);
    await refresh();
    setBatchBusy(false);
  };

  /** 合并扫描件模式：一整份 PDF（含全部签字页）一次性应用到所有签字项——纸件核对后一遍扫描即可存档，各签字项引用同一文件（归属=每人签字页在文件内可查） */
  const onCombinedUpload = async (file: File) => {
    if (!data) return;
    setBatchBusy(true);
    const results: Array<{ file: string; target: string; status: 'ok' | 'fail' | 'unmatched'; note?: string }> = [];
    const apply = async (label: string, fn: () => Promise<unknown>, tolerate?: string) => {
      try { await fn(); results.push({ file: file.name, target: label, status: 'ok' }); }
      catch (e: any) {
        const msg: string = e?.message ?? '失败';
        if (tolerate && msg.includes(tolerate)) { results.push({ file: file.name, target: label, status: 'ok', note: '不适用，跳过' }); return; }
        results.push({ file: file.name, target: label, status: 'fail', note: msg });
      }
    };
    await apply('主持人签字（开标记录）', () => uploadOpeningSignScan(projectId, 'host', file));
    await apply('监督人签字（开标记录）', () => uploadOpeningSignScan(projectId, 'supervisor', file), 'NO_SUPERVISOR');
    if (data.packet) await apply('主报告签字页（共签）', () => uploadSignaturePageScan(projectId, file));
    for (const e of data.experts ?? []) {
      if (e.role !== EXPERT_ROLE.REGULAR) continue;
      await apply(`专家·${e.name}`, () => uploadExpertScan(projectId, e.expertId, file));
    }
    const openingFail2 = results.some((x) => (x.target.startsWith('主持人') || x.target.startsWith('监督人')) && x.status === 'fail');
    if (results.some((x) => x.target.startsWith('主持人')) && !openingFail2) {
      try {
        await registerOpeningSign(projectId);
        results.push({ file: '（系统）', target: '开标记录自动登记', status: 'ok' });
      } catch (e: any) {
        results.push({ file: '（系统）', target: '开标记录自动登记', status: 'fail', note: e?.message ?? '未到齐等场景请单独补传' });
      }
    }
    setBatchResult(results);
    setSignRefreshTick((t) => t + 1);
    await refresh();
    setBatchBusy(false);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getSignPacket(projectId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (label: string, fn: () => Promise<SignPacketResponse>) => {
    setBusy(label);
    setError(null);
    try { setData(await fn()); } catch (e: any) { setError(e?.message ?? '操作失败'); } finally { setBusy(null); }
  }, []);

  const copySha = async () => {
    if (!data?.packet) return;
    await navigator.clipboard.writeText(data.packet.sha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading && !data) {
    return <div className="p-8 text-sm text-[var(--muted-foreground)]">加载签字状态…</div>;
  }
  if (!data) {
    return <div className="p-8 text-sm text-[var(--muted-foreground)]">{error ?? '无法加载签字状态'}</div>;
  }

  // 引导空态：评标结果未生成（开标记录签字若未闭环，仍给合并办理入口——打印时机在评标结束，此处即可提前/一并处理）
  if (!data.resultsGenerated) {
    return (
      <div className="space-y-4">
        <OpeningSignBlock projectId={projectId} refreshKey={signRefreshTick} />
        <div className="neu-card-static p-10 text-center">
          <PenLine size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]" strokeWidth={1.5} />
          <p className="text-sm font-semibold text-[var(--foreground)]">评标结果尚未生成</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">请在「评标管理」完成 3 步生成向导后，再来生成签字包。</p>
        </div>
      </div>
    );
  }

  const closed = data.packet?.closed ?? false;
  // A-152：电子签名专家计数（闭环横幅展示；esignature 非空即电子已签）
  const esignedCount = data.experts.filter((e) => e.esignature).length;

  return (
    <div className="space-y-4">
      <OpeningSignBlock projectId={projectId} refreshKey={signRefreshTick} />
      {/* 批量回传共用多选入口（两种卡片态都触发） */}
      <input
        ref={batchInputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])];
          e.target.value = '';
          // 单文件：文件名能命中路由（主持人/监督人/报告/正选专家名）→ 按路由传；完全无命中 → 视为合并扫描件
          if (fs.length === 1 && routeFiles(fs, data?.experts ?? [], !!data?.packet)[0].status !== 'ok') void onCombinedUpload(fs[0]);
          else void onBatchUpload(fs);
        }}
      />
      {error && (
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] px-4 py-2.5 text-xs text-[var(--danger)]">{error}</div>
      )}

      {/* 生成/下载区 */}
      {!data.packet ? (
        <div className="neu-card-static flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--foreground)]">尚未生成签字包</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">将快照当前评标数据，生成《评标报告》+ 专家声明签字页 + 个人评分确认表等全套证据包 PDF。</p>
          </div>
          {canHost && (
          <button
            type="button"
            disabled={batchBusy}
            onClick={() => batchInputRef.current?.click()}
            className="neu-btn-primary !h-[34px] !text-xs"
            title="多选扫描件一次上传，按文件名自动分配去向（含主持人/监督人/专家名；主报告页须签字包生成后回传）"
          >
            {batchBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 回传签字扫描件
          </button>
          )}
          {canHost && (
          <button
            type="button"
            disabled={busy !== null || !data.canGenerate}
            onClick={() => void run('generate', () => generateSignPacket(projectId))}
            className="neu-btn-soft !h-[34px] !text-xs"
          >
            {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Fingerprint size={13} />}
            生成签字包
          </button>
          )}
          {canHost && (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="neu-btn-soft !h-[34px] !text-xs"
            title="编辑《评标报告》十项法定内容的章节附注；生成签字包时取库内最新值"
          >
            <PenLine size={13} /> 报告附注
          </button>
          )}
          {!data.canGenerate && <span className="text-[11px] text-[var(--muted-foreground)]">当前阶段 {stage} 不可生成</span>}
        </div>
      ) : (
        <div className="neu-card-static p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                <CheckCircle2 size={14} className="text-[var(--success)]" /> 签字包已生成
                <span className="text-[11px] font-normal text-[var(--muted-foreground)] tabular-nums">
                  {new Date(data.packet.generatedAt).toLocaleString('zh-CN')}
                </span>
              </p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] tabular-nums" title={`完整性校验值（SHA-256）：${data.packet.sha256}`}>
                <Fingerprint size={11} /> SHA-256：{data.packet.sha256.slice(0, 24)}…
                <button type="button" onClick={() => void copySha()} className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">
                  <Copy size={10} /> {copied ? '已复制' : '复制'}
                </button>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!closed && canHost && (
                <button
                  type="button"
                  disabled={batchBusy}
                  onClick={() => batchInputRef.current?.click()}
                  className="neu-btn-primary !h-[34px] !text-xs"
                  title="选 1 份（合并扫描 PDF）→ 自动应用到所有签字项；选多份 → 按文件名自动分配去向（含主持人/监督人/报告/专家名）"
                >
                  {batchBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 回传签字扫描件
                </button>
              )}
              <a
                href={data.packet.downloadUrl}
                target="_blank"
                rel="noopener"
                className="neu-btn-soft !h-[34px] !text-xs"
              >
                <FileDown size={13} /> 下载签字包
              </a>
              {canHost && (
              <button
                type="button"
                disabled={busy !== null || closed}
                onClick={() => { if (window.confirm('重新生成将覆盖旧包并重置全部签字登记，确认？')) void run('generate', () => generateSignPacket(projectId)); }}
                className="neu-btn-soft !h-[34px] !text-xs hover:!text-[var(--danger)]"
              >
                <RefreshCw size={13} /> 重新生成
              </button>
              )}
              {canHost && (
              <button
                type="button"
                disabled={closed}
                onClick={() => setNotesOpen(true)}
                className="neu-btn-soft !h-[34px] !text-xs"
                title="编辑《评标报告》十项法定内容的章节附注；重新生成签字包时取库内最新值"
              >
                <PenLine size={13} /> 报告附注
              </button>
              )}
            </div>
          </div>

          {/* 主报告签字页扫描（全员共签页）——只读展示；扫描回传统一走「回传签字扫描件」入口 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] pt-3">
            <span className="text-xs text-[var(--muted-foreground)]">主报告签字页扫描（全员共签）：</span>
            {data.packet.signPageScanUrl ? (
              <a href={data.packet.signPageScanUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline">
                <FileDown size={11} /> 查看已回传扫描
              </a>
            ) : (
              <span className="text-xs text-[var(--warning,#b7791f)]">未回传</span>
            )}

          </div>
        </div>
      )}

      {/* 专家签字清单（Task 8 叠加登记按钮与弹窗）—— cgzxui 玻璃卡承表（原裸 border 无面底，玻璃卡旁显透明） */}
      <div className="neu-card-static overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--hairline)] text-[11px] text-[var(--muted-foreground)]">
              <th className="px-4 py-2.5 font-medium">专家</th>
              <th className="px-3 py-2.5 font-medium">角色</th>
              <th className="px-3 py-2.5 font-medium">签字状态</th>
              <th className="px-3 py-2.5 font-medium">不同意见</th>
              <th className="px-3 py-2.5 font-medium">扫描件</th>
              <th className="px-3 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.experts.map((e) => (
              <tr key={e.expertId} className="border-b border-[var(--hairline)] last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-semibold text-[var(--foreground)]">{e.name}</span>
                  {e.isLead && <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] text-[var(--accent)]" style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)' }}>组长</span>}
                  {/* A-132：评委分工徽标（分组 · 职责，仅显示已设维度；两维皆空则不加） */}
                  {(e.reviewGroup || e.dutyRole) && (
                    <span
                      className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]"
                      style={{ background: 'color-mix(in oklch, var(--muted-foreground) 10%, transparent)' }}
                      title="评标委员会分工（在采购管理工作台开标确认流程中配置，写入评标报告名单）"
                    >
                      {[e.reviewGroup, e.dutyRole].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <span className="ml-1 text-[11px] text-[var(--muted-foreground)]">{e.major}</span>
                </td>
                <td className="px-3 py-2.5 text-[var(--muted-foreground)]">{e.role}{e.isPurchaserRepresentative ? '·采购人代表' : ''}</td>
                <td className="px-3 py-2.5">
                  <span className="font-semibold" style={{ color: STATUS_TONE[e.signStatus] ?? 'var(--muted-foreground)' }}>
                    {STATUS_LABEL[e.signStatus] ?? e.signStatus}
                  </span>
                  {/* A-152：电子签名小徽标（SIGNED 且带 esignature = 专家端电子签署；仅纸质登记维持原展示） */}
                  {e.signStatus === 'SIGNED' && e.esignature && (
                    <span
                      className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success)]"
                      style={{ background: 'color-mix(in oklch, var(--success) 10%, transparent)' }}
                      title={`${e.esignature.algorithm} · ${e.esignature.certSn ?? '—'} · ${e.esignature.verifiedAt ?? '—'}`}
                    >
                      电子签名
                    </span>
                  )}
                  {e.signStatusAt && <span className="ml-1 text-[10px] text-[var(--muted-foreground)] tabular-nums">{new Date(e.signStatusAt).toLocaleString('zh-CN')}</span>}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2.5 text-[var(--muted-foreground)]" title={e.dissentingOpinion ?? undefined}>
                  {e.dissentingOpinion ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  {e.signScanUrl ? (
                    <a href={e.signScanUrl} target="_blank" rel="noopener" className="text-[var(--accent)] hover:underline">查看</a>
                  ) : <span className="text-[var(--muted-foreground)]">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {/* 两步走：待签只给「登记」；已登记只给「撤销」（撤销后回待签再登记）——
                      与服务端「已登记须先撤销再重登」（409 SIGN_ALREADY_REGISTERED）语义对齐，
                      不再提供提交必被 409 挡回的「重新登记」入口。
                      A-152：撤销仅主持纸质登记路径——电子已签（esignature 非空）不显示撤销，撤销电子签名须「重新生成」整包 */}
                  {!closed && canHost && e.role === EXPERT_ROLE.REGULAR && (
                    e.signStatus === 'PENDING' ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setRegistering(e)}
                        className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-40"
                      >
                        登记
                      </button>
                    ) : !e.esignature ? (
                      <button
                        title="撤销仅适用于主持登记的纸质签字；电子签名撤销须「重新生成」整包"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          if (window.confirm(`撤销 ${e.name} 的签字登记（${STATUS_LABEL[e.signStatus]}）？撤销后状态回到待签，可再点「登记」重新登记。`)) {
                            void run(`unreg-${e.expertId}`, async () => {
                              const res = await unregisterSign(projectId, e.expertId);
                              return res;
                            });
                          }
                        }}
                        className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--danger)] disabled:opacity-40"
                      >
                        撤销
                      </button>
                    ) : null
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* 批量回传结果清单——肉眼核对各文件去向；分错的可撤销登记后单传 */}
      {batchResult && (
        <div className="neu-card-static p-4">
          <div className="mb-2 flex items-center gap-2">
            <ClipboardCheck size={14} className="text-[var(--accent-strong)]" />
            <p className="text-sm font-semibold text-[var(--foreground)]">批量回传结果</p>
            <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">请核对各文件去向，分错的先撤销登记再单独上传</span>
          </div>
          <ul className="space-y-1 text-xs">
            {batchResult.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                {r.status === 'ok' && <CheckCircle2 size={12} className="shrink-0 text-[var(--success)]" />}
                {r.status === 'fail' && <XCircle size={12} className="shrink-0 text-[var(--danger)]" />}
                {r.status === 'unmatched' && <HelpCircle size={12} className="shrink-0 text-[var(--warning)]" />}
                <span className="font-mono text-[var(--foreground)]">{r.file}</span>
                <span className="text-[var(--muted-foreground)]">→</span>
                <span className={r.target ? 'text-[var(--foreground)]' : 'text-[var(--warning)]'}>{r.target || '未分配'}</span>
                {r.note && <span className="text-[var(--muted-foreground)]">（{r.note}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 闭环横幅 + 回流包 */}
      {closed && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'color-mix(in oklch, var(--success) 8%, transparent)' }}>
          <ClipboardCheck size={15} className="text-[var(--success)]" />
          <span className="text-sm font-semibold text-[var(--success)]">签字已闭环，采购管理工作台可执行完整归档</span>
          {esignedCount > 0 && <span className="text-xs text-[var(--success)]">含 {esignedCount} 位专家电子签名</span>}
          <div className="ml-auto flex items-center gap-2">
            {data.packet?.handoverFileAssetId ? (
              <a href={data.packet.handoverDownloadUrl!} target="_blank" rel="noopener" className="neu-btn-soft !h-[30px] !text-[11px]">
                <FileDown size={12} /> 下载回流包
              </a>
            ) : canHost ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run('handover', () => generateHandover(projectId))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--hairline)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-40"
              >
                {busy === 'handover' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                生成评标回流包
              </button>
            ) : null}
          </div>
        </div>
      )}

      {registering && (
        <SignRegisterDialog
          projectId={projectId}
          expert={registering}
          onClose={() => setRegistering(null)}
          onDone={async (res) => { setData(res); setRegistering(null); }}
        />
      )}

      {notesOpen && <ReportNotesDialog projectId={projectId} onClose={() => setNotesOpen(false)} />}
    </div>
  );
}

// ═══ A-151：报告附注编辑弹窗（《评标报告》十项法定内容——一~九节末以「附注：」段插入、十节拼入正文；生成签字包取库内最新） ═══
// 章节序号与后端白名单 REPORT_NOTE_SECTIONS（一~十）对应；label 与签字包 docx 渲染的 h2 逐字一致
const REPORT_NOTE_ROWS: ReadonlyArray<{ section: string; label: string }> = [
  { section: '一', label: '一、基本情况和数据表' },
  { section: '二', label: '二、评标委员会成员名单' },
  { section: '三', label: '三、开标记录' },
  { section: '四', label: '四、投标一览表' },
  { section: '五', label: '五、废标情况说明' },
  { section: '六', label: '六、评标标准、评标方法一览表' },
  { section: '七', label: '七、经评审的价格或评分比较一览表' },
  { section: '八', label: '八、排序结果与推荐中标候选人名单' },
  { section: '九', label: '九、澄清、说明、补正事项纪要' },
  { section: '十', label: '十、评标过程其他说明' },
];

function ReportNotesDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [contents, setContents] = useState<Record<string, string>>(() => Object.fromEntries(REPORT_NOTE_ROWS.map((r) => [r.section, ''] as const)));
  const [loading, setLoading] = useState(true);
  // GET 成功才放行保存——加载失败时存量未知，贸然保存会把库内附注覆盖成空白
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getReportNotes(projectId);
        if (!alive) return;
        setContents((prev) => {
          const next = { ...prev };
          for (const n of res.notes) if (n.section in next) next[n.section] = n.content;
          return next;
        });
        setLoaded(true);
        setError(null);
      } catch (e: any) {
        if (alive) setError(e?.message ?? '附注加载失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // 空行不提交；十行全空 → 提交 [] = 显式清空（后端语义，footer 已向用户点明）
      await setReportNotes(projectId, REPORT_NOTE_ROWS.map((r) => ({ section: r.section, content: contents[r.section] ?? '' })).filter((n) => n.content.trim()));
      toast.success('报告附注已保存');
      onClose();
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { if (!busy) onClose(); }}>
      <div className="flex max-h-[82vh] w-[640px] max-w-[92vw] flex-col rounded-2xl border border-[var(--hairline)] bg-[var(--background)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold text-[var(--foreground)]">报告附注 — 《评标报告》十项法定内容</p>
          <button type="button" onClick={onClose} disabled={busy} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={15} /></button>
        </div>
        <p className="mb-3 text-[11px] text-[var(--muted-foreground)]">一~九节内容以「附注：」段插入对应章节末；十节内容直接拼入报告正文。</p>

        {error && <div className="mb-3 rounded-xl border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] px-3 py-2 text-xs text-[var(--danger)]">{error}</div>}
        {loading && <div className="mb-3 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" /> 正在加载附注…</div>}

        <div className="-mr-2 flex-1 space-y-3 overflow-y-auto pr-2">
          {REPORT_NOTE_ROWS.map((r) => {
            const v = contents[r.section] ?? '';
            return (
              <div key={r.section}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--foreground)]">
                    {r.label}
                    {r.section === '十' && (
                      <span
                        className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]"
                        style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)' }}
                        title="一~九节为章末附注段，十节内容续写进本节正文"
                      >
                        拼入报告正文
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{v.length}/2000</span>
                </div>
                <textarea
                  value={v}
                  onChange={(e) => setContents((prev) => ({ ...prev, [r.section]: e.target.value }))}
                  maxLength={2000}
                  rows={2}
                  disabled={!loaded}
                  placeholder="（可不填）"
                  className="w-full resize-none rounded-xl border border-[var(--hairline)] bg-transparent px-3 py-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-t border-[var(--hairline)] pt-3">
          <p className="max-w-[380px] text-[10px] leading-relaxed text-[var(--muted-foreground)]">保存后生成/重新生成签字包时生效（生成时取库内最新）；十行全空保存即清空全部附注。</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-[var(--hairline)] px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40">取消</button>
            <button
              type="button"
              disabled={!loaded || busy}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
