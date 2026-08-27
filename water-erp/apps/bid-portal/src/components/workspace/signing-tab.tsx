'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Copy, FileDown, Fingerprint, HelpCircle, Loader2, PenLine, RefreshCw, Upload, XCircle } from 'lucide-react';
import { EXPERT_ROLE } from '@water-erp/shared';
import {
  generateHandover, generateSignPacket, getSignPacket, unregisterSign,
  uploadExpertScan, uploadSignaturePageScan,
  type SignPacketResponse, type SignPacketExpertRow,
} from '@/lib/api/sign-packet';
import { uploadOpeningSignScan, registerOpeningSign } from '@/lib/api/bid';
import SignRegisterDialog from './sign-register-dialog';
import { OpeningSignBlock } from '../opening-hall-sign-block';

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
  // ═══ 批量回传签字扫描件：一次多选 → 文件名智能路由直传 → 结果清单肉眼核对 ═══
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<Array<{ file: string; target: string; status: 'ok' | 'fail' | 'unmatched'; note?: string }> | null>(null);
  const [signRefreshTick, setSignRefreshTick] = useState(0);
  const batchInputRef = useRef<HTMLInputElement | null>(null);

  /** 文件名 → 回传目标路由（含专家名/关键词匹配；先到先得，重复与未识别留待单传）。hasPacket=false 时不含主报告页（该端点依赖签字包存在） */
  const routeFiles = (files: File[], experts: SignPacketExpertRow[], hasPacket: boolean) => {
    const taken = new Set<string>();
    return files.map((f) => {
      const name = f.name.toLowerCase();
      const match = (kw: string) => name.includes(kw);
      let target: { key: string; label: string } | null = null;
      if (!target && (match('主持人') || match('host'))) target = { key: 'host', label: '主持人签字（开标记录）' };
      if (!target && (match('监督人') || match('监督') || match('supervisor'))) target = { key: 'supervisor', label: '监督人签字（开标记录）' };
      if (!target && hasPacket && (match('报告') || match('共签') || match('声明'))) target = { key: 'report', label: '主报告签字页（共签）' };
      if (!target) {
        const expert = experts.find((e) => e.name && name.includes(e.name.toLowerCase()));
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
    // 开标记录件到齐即自动登记（与签字卡同一口径；无监督人场景主持人件即齐）
    if (hostRouted && results.every((x) => x.status !== 'fail')) {
      try { await registerOpeningSign(projectId); } catch { /* 有监督人且未到齐等场景按需单传后再看 */ }
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
    if (results.some((x) => x.target.startsWith('主持人')) && results.every((x) => x.status !== 'fail')) {
      try { await registerOpeningSign(projectId); } catch { /* 未到齐等场景由清单呈现 */ }
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
          if (fs.length === 1) void onCombinedUpload(fs[0]);
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
          <button
            type="button"
            disabled={batchBusy}
            onClick={() => batchInputRef.current?.click()}
            className="neu-btn-primary !h-[34px] !text-xs"
            title="多选扫描件一次上传，按文件名自动分配去向（含主持人/监督人/专家名；主报告页须签字包生成后回传）"
          >
            {batchBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 回传签字扫描件
          </button>
          <button
            type="button"
            disabled={busy !== null || !data.canGenerate}
            onClick={() => void run('generate', () => generateSignPacket(projectId))}
            className="neu-btn-soft !h-[34px] !text-xs"
          >
            {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Fingerprint size={13} />}
            生成签字包
          </button>
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
              <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] tabular-nums">
                <Fingerprint size={11} /> SHA-256：{data.packet.sha256.slice(0, 24)}…
                <button type="button" onClick={() => void copySha()} className="ml-1 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">
                  <Copy size={10} /> {copied ? '已复制' : '复制'}
                </button>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!closed && (
                <>
                  <button
                    type="button"
                    disabled={batchBusy}
                    onClick={() => batchInputRef.current?.click()}
                    className="neu-btn-primary !h-[34px] !text-xs"
                    title="选 1 份（合并扫描 PDF）→ 自动应用到所有签字项；选多份 → 按文件名自动分配去向（含主持人/监督人/报告/专家名）"
                  >
                    {batchBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 回传签字扫描件
                  </button>
                </>
              )}
              <a
                href={data.packet.downloadUrl}
                target="_blank"
                rel="noopener"
                className="neu-btn-soft !h-[34px] !text-xs"
              >
                <FileDown size={13} /> 下载签字包
              </a>
              <button
                type="button"
                disabled={busy !== null || closed}
                onClick={() => { if (window.confirm('重新生成将覆盖旧包并重置全部签字登记，确认？')) void run('generate', () => generateSignPacket(projectId)); }}
                className="neu-btn-soft !h-[34px] !text-xs hover:!text-[var(--danger)]"
              >
                <RefreshCw size={13} /> 重新生成
              </button>
            </div>
          </div>

          {/* 主报告签字页扫描（全员共签页）——上传交互 Task 8 叠加，此处只读展示 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] pt-3">
            <span className="text-xs text-[var(--muted-foreground)]">主报告签字页扫描（全员共签）：</span>
            {data.packet.signPageScanUrl ? (
              <a href={data.packet.signPageScanUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline">
                <FileDown size={11} /> 查看已回传扫描
              </a>
            ) : (
              <span className="text-xs text-[var(--warning,#b7791f)]">未回传</span>
            )}
            {!closed && (
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--accent)]">
                <Upload size={11} /> 上传扫描
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await run('signPage', () => uploadSignaturePageScan(projectId, f));
                    e.target.value = '';
                  }}
                />
              </label>
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
                  <span className="ml-1 text-[11px] text-[var(--muted-foreground)]">{e.major}</span>
                </td>
                <td className="px-3 py-2.5 text-[var(--muted-foreground)]">{e.role}{e.isPurchaserRepresentative ? '·采购人代表' : ''}</td>
                <td className="px-3 py-2.5">
                  <span className="font-semibold" style={{ color: STATUS_TONE[e.signStatus] ?? 'var(--muted-foreground)' }}>
                    {STATUS_LABEL[e.signStatus] ?? e.signStatus}
                  </span>
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
                  {!closed && e.role === EXPERT_ROLE.REGULAR && (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setRegistering(e)}
                        className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-40"
                      >
                        {e.signStatus === 'PENDING' ? '登记' : '重新登记'}
                      </button>
                      {e.signStatus !== 'PENDING' && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            if (window.confirm(`撤销 ${e.name} 的签字登记（${STATUS_LABEL[e.signStatus]}）？`)) {
                              void run(`unreg-${e.expertId}`, async () => {
                                const res = await unregisterSign(projectId, e.expertId);
                                return res;
                              });
                            }
                          }}
                          className="ml-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--danger)] disabled:opacity-40"
                        >
                          撤销
                        </button>
                      )}
                    </>
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
          <span className="text-sm font-semibold text-[var(--success)]">签字已闭环，:3005 可执行完整归档</span>
          <div className="ml-auto flex items-center gap-2">
            {data.packet?.handoverFileAssetId ? (
              <a href={data.packet.handoverDownloadUrl!} target="_blank" rel="noopener" className="neu-btn-soft !h-[30px] !text-[11px]">
                <FileDown size={12} /> 下载回流包
              </a>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run('handover', () => generateHandover(projectId))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--hairline)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-40"
              >
                {busy === 'handover' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                生成评标回流包
              </button>
            )}
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
    </div>
  );
}
