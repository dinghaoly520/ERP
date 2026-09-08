'use client';

/**
 * 归档区块——:3005 开评标指挥中心 Phase 2 新增。
 * 归档触发权归 :3005（总则：3005 负责所有流程流转）：
 * - OPENING：开标归档（scope=opening，流标/废标场景，终局不可逆）
 * - EVALUATING：完整归档（scope=full，须已生成评标结果）
 * - ARCHIVED：只读——归档材料清单 + 档案哈希指纹 + 归档包导出
 */

import { useEffect, useState } from 'react';
import { Archive, AlertTriangle, CheckCircle2, Copy, FileDown, Fingerprint, PenLine } from 'lucide-react';
import {
  archiveAll,
  archivePackageExportUrl,
  exportArchivePackageJson,
  getSignPacket,
  type BidProjectDetail,
  type SignPacketResponse,
} from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
  onChanged: () => void;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ArchiveBlock({ bidProjectId, detail, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmScope, setConfirmScope] = useState<'opening' | 'full' | null>(null);
  const [ackTerminate, setAckTerminate] = useState(false); // H5: 开标未完成时归档需勾选「已知晓终止」
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [copied, setCopied] = useState(false);
  // 签字闸门状态（只读，来自 :3007 评标签字包）；静默失败——按钮不禁用，后端 409 兜底
  const [signStatus, setSignStatus] = useState<SignPacketResponse | null>(null);

  // P1-9：依赖收敛到原始值签名（stage + updatedAt 刻度）——30s 轮询换引用但状态未变时不重拉
  const refreshSignal = `${detail?.stage ?? ''}|${detail?.archiveItems?.length ?? 0}`;
  useEffect(() => {
    let alive = true;
    getSignPacket(bidProjectId)
      .then((r) => { if (alive) setSignStatus(r); })
      .catch(() => { /* 签字模块未就绪/无结果时静默——按钮不禁用，后端 409 兜底 */ });
    return () => { alive = false; };
  }, [bidProjectId, refreshSignal]);

  if (!detail) return null;
  const { stage, archiveItems } = detail;
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;

  // 签字闸门三态（对齐后端 assertSignGateClosed）：未签姓名直接由 signStatus.experts 计算
  //（后端 filter 不透传 detail 数组，勿依赖 e.detail）
  const signGate = (stage === 'EVALUATING' && signStatus)
    ? !signStatus.packet
      ? { blocked: true, reason: '评标签字包未生成' }
      : !signStatus.allClosed
        ? {
            blocked: true,
            reason: `专家签字未闭环（未签：${signStatus.experts.filter((e) => e.role === '正选' && e.signStatus === 'PENDING').map((e) => e.name).join('、') || '—'}）`,
          }
        : !signStatus.packet.handoverFileAssetId
          ? { blocked: true, reason: '评标回流包未生成' }
          : { blocked: false, reason: '' }
    : { blocked: false, reason: '' };

  // H5: 开标完成度——开标未完成时归档确认需勾选「已知晓终止」（增强摩擦，流标/废标仍可归档）
  const archActive = (detail.suppliers ?? []).filter(s => s.submitStatus !== '已撤回');
  const archTotal = archActive.length;
  const archDecrypted = archActive.filter(s => s.decryptStatus === 'SUCCESS').length;
  const archDanger = archActive.filter(s => s.decryptStatus === 'DANGER').length;
  const archConfirmed = archActive.filter(s => s.confirmStatus === 'CONFIRMED').length;
  const openingIncomplete = archTotal > 0 && (archConfirmed < archTotal || archDanger > 0);

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), 3200);
  };

  async function doArchive(scope: 'opening' | 'full') {
    setConfirmScope(null);
    setBusy(true);
    try {
      await archiveAll(bidProjectId, scope);
      showToast(scope === 'opening' ? '开标归档完成' : '完整归档完成');
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '归档失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function copyRootHash(digest: string) {
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('复制失败，请手动选择复制', 'err');
    }
  }

  // F11：JSON 导出走 fetch + Blob 下载（裸 <a> 会在当前标签渲染原始 JSON 离开工作台；
  // CSV 有 Content-Disposition: attachment 无此问题，保留直链）
  async function handleExportJson() {
    try {
      const data = await exportArchivePackageJson(bidProjectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `archive-${bidProjectId.slice(-12)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'JSON 导出失败', 'err');
    }
  }

  // 档案根指纹：归档项按 id 排序后最后一项的 hashDigest（与归档端展示口径一致）
  const archivedItems = [...archiveItems].filter(i => i.status === 'ARCHIVED' && i.hashDigest);
  archivedItems.sort((a, b) => a.id.localeCompare(b.id));
  const rootDigest = archivedItems.length > 0 ? archivedItems[archivedItems.length - 1].hashDigest : null;

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="wb-icon-well wb-icon-well--xs"
            style={{ '--well-bg': 'color-mix(in oklch, var(--success) 12%, transparent)', '--well-fg': 'var(--success)' } as React.CSSProperties}
          >
            <Archive size={15} />
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">项目归档</h3>
        </div>
        <div className="flex items-center gap-2">
          {stage === 'OPENING' && (
            <button type="button" disabled={busy} onClick={() => { setAckTerminate(false); setConfirmScope('opening'); }} className="neu-btn-soft !h-[32px] !text-xs">
              <Archive size={13} /> 开标归档（流标/废标）
            </button>
          )}
          {stage === 'EVALUATING' && (
            <button type="button" disabled={busy || signGate.blocked} onClick={() => { setAckTerminate(false); setConfirmScope('full'); }} className="neu-btn-primary !h-[32px] !text-xs">
              <Archive size={13} /> 完整归档
            </button>
          )}
          {(stage === 'EVALUATING' || stage === 'ARCHIVED') && (
            <>
              <a href={archivePackageExportUrl(bidProjectId, 'csv')} className="neu-btn-soft !h-[32px] !text-xs inline-flex items-center gap-1">
                <FileDown size={13} /> CSV
              </a>
              <button type="button" onClick={() => void handleExportJson()} className="neu-btn-soft !h-[32px] !text-xs inline-flex items-center gap-1">
                <FileDown size={13} /> JSON
              </button>
            </>
          )}
        </div>
      </div>

      {/* 签字闸门警示（完整归档闸门 = 签字包 + 全员闭环 + 评标回流包） */}
      {signGate.blocked && (
        <div className="wb-tone-banner wb-tone-banner--warning mt-3 flex flex-wrap text-xs">
          <PenLine size={13} className="shrink-0" />
          <span className="font-semibold text-[var(--foreground)]">{signGate.reason}</span>
          <span className="text-[var(--muted-foreground)]">——请在 :3007 评标签字 tab 完成后重试（完整归档闸门：签字包 + 全员闭环 + 评标回流包）。</span>
        </div>
      )}

      {/* 行内反馈 */}
      {feedback && (
        <div className={`wb-tone-banner mb-3 text-xs font-semibold ${feedback.tone === 'ok' ? 'wb-tone-banner--success' : 'wb-tone-banner--danger'}`}>
          {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {feedback.text}
        </div>
      )}

      {stage !== 'ARCHIVED' ? (
        <div className="wb-note px-4 py-3.5 text-xs leading-5 text-[var(--muted-foreground)]">
          {stage === 'OPENING' ? (
            <>项目处于开标阶段。若本项目<span className="font-semibold text-[var(--foreground)]">不进入评标</span>（流标 / 废标 / 开标后终止），可执行「开标归档」——仅归档开标文件材料（不含评分明细与评标结果）。<span className="font-semibold text-[var(--danger)]">归档后流程终结，不可再启动评标。</span>需要评标请改用下方评标管理区块。</>
          ) : (
            <>项目处于评标阶段。生成评标结果后可执行「完整归档」，归档全部开评标材料并生成防篡改哈希链。若存在已确认供应商但未生成评标结果，归档会被拦截（EVALUATION_RESULTS_REQUIRED）。</>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* 档案指纹 */}
          {rootDigest && (
            <div className="wb-note flex items-center gap-2.5 px-3.5 py-2.5">
              <Fingerprint size={15} className="shrink-0 text-[var(--success)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">档案指纹（哈希链根）</div>
                <div className="truncate font-mono text-[11px] text-[var(--foreground)]" title={rootDigest}>{rootDigest}</div>
              </div>
              <button type="button" onClick={() => void copyRootHash(rootDigest)} className="neu-btn-soft !h-[28px] !px-2 !text-[11px] shrink-0">
                <Copy size={11} /> {copied ? '已复制' : '复制'}
              </button>
            </div>
          )}

          {/* 归档材料清单 */}
          <div className="overflow-hidden rounded-[14px]">
            <table className="neu-table !text-xs [&_td]:!py-2 [&_td]:!text-left [&_th]:!py-2 [&_th]:!text-left">
              <thead>
                <tr>
                  <th>归档材料</th>
                  <th>责任端</th>
                  <th>状态</th>
                  <th>归档时间</th>
                  <th>哈希摘要</th>
                </tr>
              </thead>
              <tbody>
                {archiveItems.length === 0 ? (
                  <tr><td colSpan={5} className="!py-5 text-center text-[var(--muted-foreground)]">暂无归档材料</td></tr>
                ) : (
                  archiveItems.map(item => (
                    <tr key={item.id}>
                      <td className="font-medium text-[var(--foreground)]">{item.name}</td>
                      <td className="text-[var(--muted-foreground)]">{item.ownerRole}</td>
                      <td>
                        <span
                          className="wb-status-pill"
                          style={{ '--tone': item.status === 'ARCHIVED' ? 'var(--success)' : 'var(--warning)' } as React.CSSProperties}
                        >
                          {item.status === 'ARCHIVED' ? '已归档' : '待确认'}
                        </span>
                      </td>
                      <td className="tabular-nums text-[var(--muted-foreground)]">{formatDateTime(item.archivedAt)}</td>
                      <td>
                        {item.hashDigest ? (
                          <span className="font-mono text-[10px] text-[var(--muted-foreground)]" title={item.hashDigest}>{item.hashDigest.slice(0, 18)}…</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 归档确认对话框 */}
      {confirmScope && (
        <Modal
          open
          onClose={() => setConfirmScope(null)}
          size="sm"
          footer={
            <div className="neu-btn-group">
              <button type="button" onClick={() => setConfirmScope(null)} className="neu-btn-soft">取消</button>
              <button
                type="button"
                onClick={() => void doArchive(confirmScope)}
                disabled={confirmScope === 'opening' && openingIncomplete && !ackTerminate}
                className="neu-btn-primary disabled:opacity-40"
              >
                <Archive size={13} /> 确认归档
              </button>
            </div>
          }
        >
          <div className="flex items-center gap-2">
            <div
              className="wb-icon-well wb-icon-well--sm"
              style={
                (confirmScope === 'opening'
                  ? { '--well-bg': 'color-mix(in oklch, var(--warning) 16%, transparent)', '--well-fg': 'var(--warning)' }
                  : { '--well-bg': 'color-mix(in oklch, var(--success) 16%, transparent)', '--well-fg': 'var(--success)' }) as React.CSSProperties
              }
            >
              <AlertTriangle size={15} />
            </div>
            <span className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">
              {confirmScope === 'opening' ? '确认开标归档？' : '确认完整归档？'}
            </span>
          </div>
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">
            {confirmScope === 'opening' ? (
              <>开标归档仅封存开标文件材料（项目基础信息、供应商名单、开标记录表、确认/异议记录、监督日志），<span className="font-semibold text-[var(--danger)]">归档后本项目流程终结，不可再启动评标或重新开标。</span>适用于流标、废标等开标后终止的场景。</>
            ) : (
              <>完整归档将封存全部开评标材料（含专家评分明细与评标结果汇总）并生成防篡改哈希链，归档后项目进入 ARCHIVED 终态。</>
            )}
          </p>
          {/* F15：开标归档确认框动态展示当前开标进度，避免开标进行中误终局 */}
          {confirmScope === 'opening' && (() => {
            const active = (detail?.suppliers ?? []).filter(s => s.submitStatus !== '已撤回');
            const total = active.length;
            const decrypted = active.filter(s => s.decryptStatus === 'SUCCESS').length;
            const danger = active.filter(s => s.decryptStatus === 'DANGER').length;
            const confirmed = active.filter(s => s.confirmStatus === 'CONFIRMED').length;
            if (total === 0) return null;
            return (
              <div className="wb-tone-banner wb-tone-banner--warning text-xs leading-5">
                <span className="font-bold text-[var(--foreground)]">当前开标进度：</span>
                <span className="tabular-nums text-[var(--muted-foreground)]">
                  解密 {decrypted}/{total}{danger > 0 && `（含 ${danger} 家解密异常）`} · 确认 {confirmed}/{total}
                </span>
                {confirmed < total && <span className="ml-1 font-semibold">—— 仍有供应商未确认，确认要终止流程？</span>}
              </div>
            );
          })()}
          {confirmScope === 'opening' && openingIncomplete && (
            <label className="flex cursor-pointer items-start gap-2 rounded-[12px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3.5 py-2.5 text-xs leading-5">
              <input type="checkbox" checked={ackTerminate} onChange={e => setAckTerminate(e.target.checked)} className="neu-checkbox" />
              <span className="text-[var(--foreground)]">我已知晓开标尚未完成（解密 {archDecrypted}/{archTotal}{archDanger > 0 && `，含 ${archDanger} 家异常`}、确认 {archConfirmed}/{archTotal}），确认终止本项目流程。</span>
            </label>
          )}
        </Modal>
      )}
    </section>
  );
}
