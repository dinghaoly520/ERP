'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Copy, FileDown, Fingerprint, Loader2, PenLine, RefreshCw, Upload } from 'lucide-react';
import {
  generateHandover, generateSignPacket, getSignPacket, unregisterSign,
  uploadExpertScan, uploadSignaturePageScan,
  type SignPacketResponse, type SignPacketExpertRow,
} from '@/lib/api/sign-packet';
import SignRegisterDialog from './sign-register-dialog';

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

  // 引导空态：评标结果未生成
  if (!data.resultsGenerated) {
    return (
      <div className="rounded-2xl border border-[var(--hairline)] p-10 text-center">
        <PenLine size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]" strokeWidth={1.5} />
        <p className="text-sm font-semibold text-[var(--foreground)]">评标结果尚未生成</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">请在「评标管理」完成 3 步生成向导后，再来生成签字包。</p>
      </div>
    );
  }

  const closed = data.packet?.closed ?? false;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] px-4 py-2.5 text-xs text-[var(--danger)]">{error}</div>
      )}

      {/* 生成/下载区 */}
      {!data.packet ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--hairline)] p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--foreground)]">尚未生成签字包</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">将快照当前评标数据，生成《评标报告》+ 专家声明签字页 + 个人评分确认表等全套证据包 PDF。</p>
          </div>
          <button
            type="button"
            disabled={busy !== null || !data.canGenerate}
            onClick={() => void run('generate', () => generateSignPacket(projectId))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--hairline)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] disabled:opacity-40"
          >
            {busy === 'generate' ? <Loader2 size={13} className="animate-spin" /> : <Fingerprint size={13} />}
            生成签字包
          </button>
          {!data.canGenerate && <span className="text-[11px] text-[var(--muted-foreground)]">当前阶段 {stage} 不可生成</span>}
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--hairline)] p-4">
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
              <a
                href={data.packet.downloadUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--hairline)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)]"
              >
                <FileDown size={13} /> 下载签字包
              </a>
              <button
                type="button"
                disabled={busy !== null || closed}
                onClick={() => { if (window.confirm('重新生成将覆盖旧包并重置全部签字登记，确认？')) void run('generate', () => generateSignPacket(projectId)); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--hairline)] px-3 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--danger)] disabled:opacity-40"
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

      {/* 专家签字清单（Task 8 叠加登记按钮与弹窗） */}
      <div className="overflow-x-auto rounded-2xl border border-[var(--hairline)]">
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
                  {!e.signScanUrl && !closed && e.role === '正选' && (
                    <label className="ml-2 inline-flex cursor-pointer items-center gap-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--accent)]">
                      <Upload size={10} /> 上传
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={async (ev) => {
                          const f = ev.target.files?.[0];
                          if (f) await run(`scan-${e.expertId}`, () => uploadExpertScan(projectId, e.expertId, f));
                          ev.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {!closed && e.role === '正选' && (
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

      {/* 闭环横幅 + 回流包 */}
      {closed && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'color-mix(in oklch, var(--success) 8%, transparent)' }}>
          <ClipboardCheck size={15} className="text-[var(--success)]" />
          <span className="text-sm font-semibold text-[var(--success)]">签字已闭环，:3005 可执行完整归档</span>
          <div className="ml-auto flex items-center gap-2">
            {data.packet?.handoverFileAssetId ? (
              <a href={data.packet.handoverDownloadUrl!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-xl border border-[var(--hairline)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)]">
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
