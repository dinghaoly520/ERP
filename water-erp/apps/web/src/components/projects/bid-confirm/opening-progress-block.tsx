'use client';

/**
 * 开标进度区块（只读）——:3005 开评标指挥中心 Phase 2 新增。
 * 展示 :3007 开标大厅的执行进度（会话信息 / 解密 / 唱标 / 确认 / 异议），
 * 数据来自父组件传入的 BidProjectDetail，实时性由父组件的 socket 刷新驱动。
 */

import { ExternalLink, Gavel, KeyRound, FileCheck, UserCheck, AlertTriangle, Ban } from 'lucide-react';
import { portalURL } from '@water-erp/config';
import { deriveOpeningSessionStatus } from '@water-erp/shared';
import type { BidProjectDetail } from '@/lib/api/bid';

type Props = {
  detail: BidProjectDetail | null;
  /** 开标完成后：流标（→ 打开流标公告制作） */
  onAbort?: () => void;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ProgressStat({
  icon, label, done, total, tone,
}: {
  icon: React.ReactNode;
  label: string;
  done: number;
  total: number;
  tone: 'accent' | 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success' ? 'var(--success)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'danger' ? 'var(--danger)' : 'var(--accent)';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="neu-tile flex-1 px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="mb-1.5 flex items-baseline gap-1">
        <span className="text-xl font-black tabular-nums tracking-[-0.03em] text-[var(--foreground)]">{done}</span>
        <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">/ {total}</span>
        <span className="ml-auto text-[10px] font-bold tabular-nums" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[oklch(0.9_0.01_258/0.8)]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function OpeningProgressBlock({ detail, onAbort }: Props) {
  if (!detail) return null;
  const { stage, openingSession, suppliers, openingRecords } = detail;
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;

  const total = suppliers.length;
  const decrypted = suppliers.filter(s => s.decryptStatus === 'SUCCESS').length;
  const recorded = openingRecords.length;
  const confirmed = suppliers.filter(s => s.confirmStatus === 'CONFIRMED').length;
  const disputed = suppliers.filter(s => s.confirmStatus === 'DISPUTED').length;
  // 开标完成判定（口径对齐后端可评供应商过滤集）：已撤回排除；解密已处理 = SUCCESS/DANGER；
  // 唱标覆盖全部解密成功供应商；确认闭环仅对 SUCCESS 供应商要求 CONFIRMED/EXCEPTION；无 DISPUTED 悬置
  const activeSuppliers = suppliers.filter(s => s.submitStatus !== '已撤回');
  const successSuppliers = activeSuppliers.filter(s => s.decryptStatus === 'SUCCESS');
  const openingDone = activeSuppliers.length > 0
    && activeSuppliers.every(s => s.decryptStatus === 'SUCCESS' || s.decryptStatus === 'DANGER')
    && recorded >= successSuppliers.length
    && successSuppliers.every(s => s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION')
    && disputed === 0;

  const gotoHall = () => window.open(portalURL('bid', '/bid'), '_blank');

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="wb-icon-well wb-icon-well--xs"
            style={{ '--well-bg': 'color-mix(in oklch, var(--accent) 12%, transparent)', '--well-fg': 'var(--accent)' } as React.CSSProperties}
          >
            <Gavel size={15} />
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">开标进度</h3>
          <span className="text-[10px] text-[var(--muted-foreground)]">实时同步自开标大厅</span>
        </div>
        {stage === 'OPENING' && (
          <button type="button" onClick={gotoHall} className="neu-btn-soft !h-[32px] !text-xs">
            <ExternalLink size={13} /> 前往开标大厅
          </button>
        )}
      </div>

      {!openingSession ? (
        /* 已确定开标（stage=OPENING）但主持人尚未组建会话 */
        <div className="wb-tone-banner wb-tone-banner--warning py-4">
          <AlertTriangle size={16} className="shrink-0" />
          <div className="flex-1 text-xs leading-5">
            <span className="font-semibold text-[var(--foreground)]">已确定开标，等待组建开标会话。</span>
            <span className="text-[var(--muted-foreground)]">请开标主持人前往开标大厅，填写主持人与解密窗口（监督人选填）后即可开始解密。</span>
          </div>
          {stage === 'OPENING' && (
            <button type="button" onClick={gotoHall} className="neu-btn-primary !h-[32px] !text-xs shrink-0">
              <ExternalLink size={13} /> 去组建会话
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* 会话信息 */}
          <div className="wb-note flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3.5 py-2.5 text-xs">
            <span className="text-[var(--muted-foreground)]">主持人 <span className="ml-1 font-semibold text-[var(--foreground)]">{openingSession.host}</span></span>
            <span className="text-[var(--muted-foreground)]">监督人 <span className="ml-1 font-semibold text-[var(--foreground)]">{openingSession.supervisor ?? '未指定'}</span></span>
            <span className="text-[var(--muted-foreground)]">
              解密窗口
              <span className="ml-1 font-semibold tabular-nums text-[var(--foreground)]">
                {formatDateTime(openingSession.decryptWindowStart)} ~ {formatDateTime(openingSession.decryptWindowEnd)}
              </span>
            </span>
            <span
              className="wb-status-pill ml-auto"
            >
              {/* L6（2026-08-28）：status 列建档后无流转（恒「待开标」），改 shared 派生（暂停/窗口关/已移交/阶段终止） */}
              {deriveOpeningSessionStatus({
                stage,
                pausedAt: openingSession.pausedAt,
                handoverAt: openingSession.handoverAt,
                decryptWindowStart: openingSession.decryptWindowStart,
                decryptWindowEnd: openingSession.decryptWindowEnd,
              })}
            </span>
          </div>

          {/* 开标资料移交接收（:3007 完成开标后回传） */}
          {openingSession.handoverAt && openingSession.handoverAssetId && (
            <div className="wb-tone-banner wb-tone-banner--success flex-wrap text-xs">
              <UserCheck size={13} className="shrink-0 text-[var(--success)]" />
              <span className="font-semibold text-[var(--success)]">开标资料已接收（{formatDateTime(openingSession.handoverAt)}）</span>
              <a
                href={`/api/upload/files/${openingSession.handoverAssetId}`}
                target="_blank"
                rel="noopener"
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] hover:underline"
              >
                <FileCheck size={11} /> 下载开标文件包
              </a>
            </div>
          )}

          {/* 进度四联 */}
          <div className="flex flex-wrap gap-2.5">
            <ProgressStat icon={<KeyRound size={12} />} label="标书解密" done={decrypted} total={total} tone={decrypted === total && total > 0 ? 'success' : 'accent'} />
            <ProgressStat icon={<FileCheck size={12} />} label="唱标录入" done={Math.min(recorded, total)} total={total} tone={recorded >= total && total > 0 ? 'success' : 'accent'} />
            <ProgressStat icon={<UserCheck size={12} />} label="供应商确认" done={confirmed} total={total} tone={confirmed === total && total > 0 ? 'success' : 'accent'} />
            <ProgressStat icon={<AlertTriangle size={12} />} label="待处理异议" done={disputed} total={total} tone={disputed > 0 ? 'danger' : 'success'} />
          </div>

          {openingDone && stage === 'OPENING' && (
            <div className="wb-tone-banner wb-tone-banner--success flex-wrap py-3">
              <UserCheck size={14} className="text-[var(--success)]" />
              <span className="text-xs font-semibold text-[var(--success)] mr-auto">开标已完成——确认开标结果进入评标由开评标管理端（:3007）执行；如需流标，请在此发起。</span>
              {onAbort && (
                <button type="button" onClick={onAbort} className="neu-btn-soft is-danger !h-[32px] !text-xs">
                  <Ban size={13} /> 流标
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
