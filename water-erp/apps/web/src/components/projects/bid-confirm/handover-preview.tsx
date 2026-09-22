'use client';

/**
 * 评标回流包内容查验视图（P2-3，2026-09-22 归档链路审查遗留 UI 项）——只读结构化预览。
 * 归档人员核卷不再下载 JSON 人工看：懒加载 fetch handoverDownloadUrl（同源 proxy.ts → :4001，
 * cookie 自动携带），分段渲染包内容（概要 / 签字与身份核验 / 评分快照 / 澄清·异议·动议·条款裁定 /
 * 专家备忘 / AI 辅助 / 监督日志）。
 *
 * - 只读：不提供任何写操作入口；下载走既有 handoverDownloadUrl（受保护下载，禁 rel=noreferrer）
 * - 包较大（演示包 ~220KB）：首次展开才 fetch 并缓存；「重新加载」强制重拉（同 key 覆盖重生成场景）
 * - 三态齐全：加载中 / 错误（横幅+重试，不吞） / 空段（真实空态文案，无 mock 兜底）
 * - 形状权威：apps/api/src/bid/bid-sign-packet.service.ts generateHandover（packageVersion=2）。
 *   字段一律防御式可选——v1 历史包或段缺失时按空态渲染，不崩。
 * - 包内 supplierId → 名称映射仅 evaluationResults 一处（scoreRecords/pointDecisions 只存 id，
 *   包自描述原则下不回库反查）；expertId 全包无姓名映射源，故评分矩阵取「供应商 × 评分项」
 *   聚合口径（专家维度由 expertConfirmations 表承担），对照 evaluationResults.totalScore 可核勾稽。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileSearch,
  MessagesSquare,
  PenLine,
  RefreshCw,
  ScrollText,
  Sigma,
  StickyNote,
  X,
} from 'lucide-react';

/* ── 包类型（宽松可选；权威见 api 端 generateHandover） ── */

interface FileRef {
  fileAssetId: string;
  key?: string;
  originalName?: string;
  size?: number;
  sha256?: string;
}

interface HandoverPackage {
  packageType?: string;
  packageVersion?: number;
  generatedAt?: string;
  projectId?: string;
  evaluationSnapshot?: {
    expertConfirmations?: { expertName: string; expertRole?: string; reportConfirmed?: boolean; reportConfirmedAt?: string | null; progress?: number; totalScore?: number }[];
    scoreRecords?: { expertId: string; supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; reason?: string | null }[];
    scoreHistory?: { expertId: string; supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; action?: string; createdAt?: string }[];
    pointDecisions?: { expertId: string; pointId: string; supplierId: string; checked: boolean; awardedScore?: number; note?: string | null }[];
    scoreItemDefinitions?: { id: string; name: string; category?: string; maxScore?: number; points?: { id: string; name: string }[] }[];
    fingerprint?: string;
  } | null;
  evaluationResults?: { supplierId: string; supplierName: string; totalScore?: number; averageScore?: number; rank?: number; recommended?: boolean; disqualified?: boolean; bidPrice?: number | null; generatedAt?: string }[];
  signPacket?: { fileAssetId?: string; sha256?: string; generatedAt?: string; signPageScanFileId?: string | null; closedAt?: string | null } | null;
  expertSignStatuses?: ExpertSignStatus[];
  expertMemos?: { expertName?: string; supplierName?: string | null; scoreItemName?: string | null; scorePointName?: string | null; contentText?: string; sourceDevice?: string; createdAt?: string; ink?: FileRef | null }[];
  requirementReviews?: { expertName?: string; supplierName?: string | null; requirementId?: string; category?: string; verdict?: string; note?: string | null; createdAt?: string }[];
  aiAnalysis?: {
    status?: string;
    aiProvenance?: Record<string, unknown> | null;
    bidders?: { supplierName?: string | null; qualificationStatus?: string; riskLevel?: string; totalScore?: number | null; processedAt?: string | null }[];
    report?: {
      conclusion?: string | null; recommendation?: string | null; generatedAt?: string | null;
      riskStats?: { lowCount?: number; mediumCount?: number; highCount?: number; fraudRiskLevel?: string; fraudIndicatorCount?: number } | null;
      docx?: FileRef | null; pdf?: FileRef | null;
    } | null;
  } | null;
  supervisionLogs?: { time: string; role?: string; action?: string; target?: string | null; result?: string | null; riskFlag?: string | null }[];
  disputes?: { id?: string; expertName?: string; type?: string; title?: string; content?: string; status?: string; response?: string | null; resolvedBy?: string | null; resolvedAt?: string | null; createdAt?: string }[];
  motions?: { id?: string; type?: string; title?: string; description?: string; status?: string; result?: string | null; createdBy?: string; closedAt?: string | null; votes?: { expertName?: string; vote?: string; reason?: string | null; createdAt?: string }[] }[];
  clarifications?: { id?: string; type?: string; supplierName?: string; question?: string; issuer?: string; reply?: string | null; status?: string; replyChannel?: string | null; replySignature?: string | null; replyAttachmentIds?: string[]; replyByName?: string | null; createdAt?: string }[];
}

interface ExpertSignStatus {
  expertName: string;
  expertRole?: string;
  signStatus?: string;
  signStatusAt?: string | null;
  dissentingOpinion?: string | null;
  dissentingReason?: string | null;
  esignature?: Record<string, unknown> | null;
  esignatureAt?: string | null;
  signedIn?: boolean;
  signInIp?: string | null;
  signInMeta?: { ip?: string; timestamp?: string; userAgent?: string; photoAssetId?: string } | null;
  confidentialityAgreed?: boolean;
  disciplineAgreed?: boolean;
  aiConsentConfirmed?: boolean;
  avoidanceConfirmed?: boolean;
  conflictedSupplierIds?: string[];
}

/* ── 工具 ── */

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const SIGN_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  SIGNED: { label: '已签字', tone: 'var(--success)' },
  REFUSED_DISSENT: { label: '拒绝（附不同意见）', tone: 'var(--danger)' },
  DEEMED_AGREED: { label: '视为同意', tone: 'var(--warning)' },
  PENDING: { label: '待签字', tone: 'var(--muted-foreground)' },
};

const RISK_TONES: Record<string, { label: string; tone: string }> = {
  high: { label: '高风险', tone: 'var(--danger)' },
  medium: { label: '中风险', tone: 'var(--warning)' },
  low: { label: '低风险', tone: 'var(--accent)' },
};

/** 监督日志 riskFlag 高亮口径：'无'/'—'（占位）不标；高风险=红、关注/低=橙 */
function riskFlagTone(flag?: string | null): string | null {
  if (flag === '高风险') return 'var(--danger)';
  if (flag === '关注' || flag === '低') return 'var(--warning)';
  return null;
}

function shortHash(hash?: string | null): string {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}

function yuan(v?: number | null): string {
  return v != null ? `¥${Number(v).toLocaleString('zh-CN')}` : '—';
}

/* ── 展开段小件 ── */

function Section({
  icon, title, hint, defaultOpen = true, children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="wb-note px-3.5 py-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-[var(--accent)]">{icon}</span>
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">{title}</span>
        {hint && <span className="text-[10px] text-[var(--muted-foreground)]">{hint}</span>}
        <ChevronDown
          size={14}
          className={`ml-auto shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="rounded-[10px] px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">{text}</div>;
}

function AgreeMark({ ok }: { ok?: boolean }) {
  return ok ? (
    <Check size={12} className="shrink-0 text-[var(--success)]" aria-label="已确认" />
  ) : (
    <X size={12} className="shrink-0 text-[var(--muted-foreground)] opacity-50" aria-label="未确认" />
  );
}

/* ── 各段渲染 ── */

function SummarySection({ pkg }: { pkg: HandoverPackage }) {
  const results = pkg.evaluationResults ?? [];
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span>包版本 <span className="font-mono font-semibold text-[var(--foreground)]">v{pkg.packageVersion ?? '?'}</span></span>
        <span>生成时间 <span className="tabular-nums text-[var(--foreground)]">{formatDateTime(pkg.generatedAt)}</span></span>
        <span>签字闭环 <span className="tabular-nums text-[var(--foreground)]">{formatDateTime(pkg.signPacket?.closedAt)}</span></span>
        <span title={`evaluationSnapshot 指纹 ${pkg.evaluationSnapshot?.fingerprint ?? ''}`}>
          快照指纹 <span className="font-mono text-[var(--foreground)]">{shortHash(pkg.evaluationSnapshot?.fingerprint)}</span>
        </span>
      </div>
      {results.length > 0 ? (
        <div className="overflow-hidden rounded-[12px]">
          <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
            <thead>
              <tr>
                <th className="!text-left">名次</th>
                <th className="!text-left">供应商</th>
                <th className="!text-right">总得分</th>
                <th className="!text-right">平均分</th>
                <th className="!text-right">报价（元）</th>
                <th className="!text-left">状态</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.supplierId ?? i}>
                  <td className="!text-left font-mono font-bold tabular-nums text-[var(--foreground)]">{r.rank ?? i + 1}</td>
                  <td className="!text-left font-medium text-[var(--foreground)]">{r.supplierName}</td>
                  <td className="!text-right font-mono tabular-nums">{r.totalScore != null ? Number(r.totalScore).toFixed(2) : '—'}</td>
                  <td className="!text-right font-mono tabular-nums">{r.averageScore != null ? Number(r.averageScore).toFixed(2) : '—'}</td>
                  <td className="!text-right font-mono tabular-nums text-[var(--foreground)]">{yuan(r.bidPrice)}</td>
                  <td className="!text-left">
                    {r.disqualified ? (
                      <span className="wb-status-pill" style={{ '--tone': 'var(--danger)' } as React.CSSProperties}>废标</span>
                    ) : r.recommended ? (
                      <span className="wb-status-pill" style={{ '--tone': 'var(--success)' } as React.CSSProperties}>中标候选人</span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            包内快照（核卷基准，金额为元口径）；上方「中标候选人」表来自数据库，两者应一致
          </div>
        </div>
      ) : (
        <EmptyHint text="包内无评标结果段" />
      )}
    </div>
  );
}

function SignSection({ pkg }: { pkg: HandoverPackage }) {
  const all = pkg.expertSignStatuses ?? [];
  const primary = all.filter((s) => s.expertRole !== '候补');
  const alternates = all.filter((s) => s.expertRole === '候补');
  const [showAlt, setShowAlt] = useState(false);

  function renderRows(rows: ExpertSignStatus[]) {
    return rows.map((s, i) => {
      const st = SIGN_STATUS_LABELS[s.signStatus ?? ''] ?? { label: s.signStatus ?? '—', tone: 'var(--muted-foreground)' };
      return (
        <tr key={`${s.expertName}-${i}`}>
          <td className="!text-left font-medium text-[var(--foreground)]">{s.expertName}</td>
          <td className="!text-left text-[var(--muted-foreground)]">{s.expertRole ?? '—'}</td>
          <td className="!text-left">
            <span className="wb-status-pill" style={{ '--tone': st.tone } as React.CSSProperties}>{st.label}</span>
          </td>
          <td className="!text-left tabular-nums text-[var(--muted-foreground)]">{formatDateTime(s.signStatusAt)}</td>
          <td className="!text-left">
            {s.signedIn ? (
              <span className="text-[var(--foreground)]">
                已签到{ s.signInIp ? <span className="font-mono text-[10px] text-[var(--muted-foreground)]">（{s.signInIp}）</span> : null }
              </span>
            ) : (
              <span className="text-[var(--muted-foreground)]">未签到</span>
            )}
          </td>
          <td className="!text-left">
            <span className="inline-flex items-center gap-1.5" title="保密承诺 / 评标纪律 / AI 辅助声明 / 回避确认">
              <AgreeMark ok={s.confidentialityAgreed} />
              <AgreeMark ok={s.disciplineAgreed} />
              <AgreeMark ok={s.aiConsentConfirmed} />
              <AgreeMark ok={s.avoidanceConfirmed} />
            </span>
          </td>
          <td className="!text-left max-w-[260px]">
            {s.dissentingOpinion ? (
              <span className="text-[var(--danger)]" title={s.dissentingReason ?? undefined}>
                {s.dissentingOpinion.length > 40 ? `${s.dissentingOpinion.slice(0, 40)}…` : s.dissentingOpinion}
              </span>
            ) : s.esignature ? (
              <span className="text-[var(--muted-foreground)]" title={`电子签名 ${formatDateTime(s.esignatureAt)}`}>电子签名已留痕</span>
            ) : (
              <span className="text-[var(--muted-foreground)]">—</span>
            )}
          </td>
        </tr>
      );
    });
  }

  const head = (
    <thead>
      <tr>
        <th className="!text-left">专家</th>
        <th className="!text-left">角色</th>
        <th className="!text-left">签字状态</th>
        <th className="!text-left">签字时间</th>
        <th className="!text-left">身份核验</th>
        <th className="!text-left">承诺勾选</th>
        <th className="!text-left">不同意见 / 电子签名</th>
      </tr>
    </thead>
  );

  if (all.length === 0) return <EmptyHint text="包内无专家签字记录" />;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-[12px]">
        <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2 min-w-[720px]">
          {head}
          <tbody>{renderRows(primary)}</tbody>
        </table>
      </div>
      {alternates.length > 0 && (
        <div>
          <button
            type="button"
            className="neu-btn-xs"
            onClick={() => setShowAlt(!showAlt)}
          >
            <ChevronDown size={12} className={showAlt ? 'rotate-180' : ''} />
            候补专家（{alternates.length} 人）
          </button>
          {showAlt && (
            <div className="mt-2 overflow-x-auto rounded-[12px]">
              <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2 min-w-[720px]">
                {head}
                <tbody>{renderRows(alternates)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="text-[10px] text-[var(--muted-foreground)]">
        承诺勾选从左至右：保密承诺、评标纪律、AI 辅助声明、回避确认；回避冲突供应商以包内 conflictedSupplierIds 留痕
      </div>
    </div>
  );
}

function ScoreSnapshotSection({ pkg }: { pkg: HandoverPackage }) {
  const snap = pkg.evaluationSnapshot ?? {};
  const confirmations = snap.expertConfirmations ?? [];
  const defs = snap.scoreItemDefinitions ?? [];
  const records = snap.scoreRecords ?? [];
  const history = snap.scoreHistory ?? [];
  const decisions = snap.pointDecisions ?? [];
  const results = pkg.evaluationResults ?? [];

  // supplierId → 包内名称（evaluationResults 是唯一名称源；无结果的供应商回退短 id）
  const supplierName = new Map(results.map((r) => [r.supplierId, r.supplierName]));
  const supLabel = (id: string) => supplierName.get(id) ?? `供应商 ${id.slice(-6)}`;
  // 供应商列序：evaluationResults 名次序在前，其余按首现顺序
  const suppliers = [
    ...results.map((r) => r.supplierId),
    ...[...new Set(records.map((r) => r.supplierId))].filter((id) => !supplierName.has(id)),
  ];

  // 供应商 × 评分项 聚合（各专家合计；expertId 包内无姓名映射源，故取此口径）
  const cell = new Map<string, { sum: number; n: number }>();
  for (const r of records) {
    const key = `${r.supplierId}|${r.scoreItemId}`;
    const c = cell.get(key) ?? { sum: 0, n: 0 };
    c.sum += Number(r.score) || 0;
    c.n += 1;
    cell.set(key, c);
  }
  const resultBySupplier = new Map(results.map((r) => [r.supplierId, r]));

  // pointDecisions 按供应商聚合（明细按得分点折叠）
  const pdBySupplier = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const arr = pdBySupplier.get(d.supplierId) ?? [];
    arr.push(d);
    pdBySupplier.set(d.supplierId, arr);
  }
  const pointName = new Map(defs.flatMap((d) => d.points?.map((p) => [p.id, p.name] as const) ?? []));

  const [showDecisions, setShowDecisions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span>
          评分项 <span className="font-semibold text-[var(--foreground)]">{defs.length}</span> 项 ·
          评分记录 <span className="font-semibold text-[var(--foreground)]">{records.length}</span> 条 ·
          专家 <span className="font-semibold text-[var(--foreground)]">{confirmations.length}</span> 人
        </span>
        <span title={`完整指纹 ${snap.fingerprint ?? ''}`} className="font-mono">
          {shortHash(snap.fingerprint)}
        </span>
      </div>

      {/* 专家评审进度 */}
      {confirmations.length > 0 && (
        <div className="overflow-x-auto rounded-[12px]">
          <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
            <thead>
              <tr>
                <th className="!text-left">专家</th>
                <th className="!text-left">角色</th>
                <th className="!text-right">评分进度</th>
                <th className="!text-right">个人总分</th>
                <th className="!text-left">评审报告</th>
              </tr>
            </thead>
            <tbody>
              {confirmations.map((e, i) => (
                <tr key={`${e.expertName}-${i}`}>
                  <td className="!text-left font-medium text-[var(--foreground)]">{e.expertName}</td>
                  <td className="!text-left text-[var(--muted-foreground)]">{e.expertRole ?? '—'}</td>
                  <td className="!text-right font-mono tabular-nums">{e.progress != null ? `${e.progress}%` : '—'}</td>
                  <td className="!text-right font-mono tabular-nums">{e.totalScore != null ? Number(e.totalScore).toFixed(2) : '—'}</td>
                  <td className="!text-left">
                    {e.reportConfirmed ? (
                      <span className="wb-status-pill" style={{ '--tone': 'var(--success)' } as React.CSSProperties}>已确认</span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">未确认</span>
                    )}
                    <span className="ml-2 tabular-nums text-[10px] text-[var(--muted-foreground)]">{formatDateTime(e.reportConfirmedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 评分定义 + 供应商×评分项聚合矩阵（尾行与评标结果总分勾稽） */}
      {defs.length > 0 && suppliers.length > 0 && (
        <div className="overflow-x-auto rounded-[12px]">
          <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2 min-w-[560px]">
            <thead>
              <tr>
                <th className="!text-left">评分项</th>
                {suppliers.map((id) => (
                  <th key={id} className="!text-right">{supLabel(id)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {defs.map((d) => (
                <tr key={d.id}>
                  <td className="!text-left font-medium text-[var(--foreground)]">
                    {d.name}
                    {d.maxScore != null && <span className="ml-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">/{Number(d.maxScore)}</span>}
                  </td>
                  {suppliers.map((sid) => {
                    const c = cell.get(`${sid}|${d.id}`);
                    return (
                      <td key={sid} className="!text-right font-mono tabular-nums" title={c ? `${c.n} 位专家合计` : undefined}>
                        {c ? c.sum.toFixed(2) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="!text-left font-semibold text-[var(--foreground)]">专家合计（包内）</td>
                {suppliers.map((sid) => {
                  const total = [...cell.entries()]
                    .filter(([k]) => k.startsWith(`${sid}|`))
                    .reduce((acc, [, c]) => acc + c.sum, 0);
                  return (
                    <td key={sid} className="!text-right font-mono font-semibold tabular-nums text-[var(--foreground)]">{total.toFixed(2)}</td>
                  );
                })}
              </tr>
              <tr>
                <td className="!text-left text-[var(--muted-foreground)]">评标结果总分（对照）</td>
                {suppliers.map((sid) => {
                  const r = resultBySupplier.get(sid);
                  return (
                    <td key={sid} className="!text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                      {r?.totalScore != null ? Number(r.totalScore).toFixed(2) : '—'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            矩阵为各评分项全体专家合计分；末两行应一致（勾稽校验）
          </div>
        </div>
      )}

      {/* 得分点裁定（非空才显） */}
      {decisions.length > 0 && (
        <div>
          <button type="button" className="neu-btn-xs" onClick={() => setShowDecisions(!showDecisions)}>
            <ChevronDown size={12} className={showDecisions ? 'rotate-180' : ''} />
            得分点裁定（{decisions.length} 条）
          </button>
          {showDecisions && (
            <div className="mt-2 overflow-x-auto rounded-[12px]">
              <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
                <thead>
                  <tr>
                    <th className="!text-left">供应商</th>
                    <th className="!text-right">裁定记录</th>
                    <th className="!text-right">勾选</th>
                    <th className="!text-right">裁定分合计</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pdBySupplier.entries()].map(([sid, arr]) => (
                    <tr key={sid}>
                      <td className="!text-left font-medium text-[var(--foreground)]">{supLabel(sid)}</td>
                      <td className="!text-right font-mono tabular-nums">{arr.length}</td>
                      <td className="!text-right font-mono tabular-nums">{arr.filter((d) => d.checked).length}</td>
                      <td className="!text-right font-mono tabular-nums">
                        {arr.reduce((acc, d) => acc + (Number(d.awardedScore) || 0), 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                逐专家 × 得分点记录聚合；得分点名称见评分项定义（{defs.reduce((a, d) => a + (d.points?.length ?? 0), 0)} 个得分点）
                {pointName.size === 0 ? '' : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 评分修订轨迹（非空才显） */}
      {history.length > 0 && (
        <div>
          <button type="button" className="neu-btn-xs" onClick={() => setShowHistory(!showHistory)}>
            <ChevronDown size={12} className={showHistory ? 'rotate-180' : ''} />
            评分修订轨迹（{history.length} 条）
          </button>
          {showHistory && (
            <div className="mt-2 overflow-x-auto rounded-[12px]">
              <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
                <thead>
                  <tr>
                    <th className="!text-left">修订时间</th>
                    <th className="!text-left">供应商</th>
                    <th className="!text-right">修订后分</th>
                    <th className="!text-left">动作</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td className="!text-left tabular-nums text-[var(--muted-foreground)]">{formatDateTime(h.createdAt)}</td>
                      <td className="!text-left font-medium text-[var(--foreground)]">{supLabel(h.supplierId)}</td>
                      <td className="!text-right font-mono tabular-nums">{Number(h.score).toFixed(2)}</td>
                      <td className="!text-left">{h.action ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProcessRecordsSection({ pkg }: { pkg: HandoverPackage }) {
  const disputes = pkg.disputes ?? [];
  const motions = pkg.motions ?? [];
  const clarifications = pkg.clarifications ?? [];
  const reviews = pkg.requirementReviews ?? [];

  return (
    <div className="space-y-2.5">
      {/* 异议 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--foreground)]">异议（{disputes.length}）</div>
        {disputes.length === 0 ? (
          <EmptyHint text="本项目无异议记录" />
        ) : (
          <div className="overflow-x-auto rounded-[12px]">
            <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
              <thead>
                <tr>
                  <th className="!text-left">提出人</th>
                  <th className="!text-left">类型</th>
                  <th className="!text-left">内容</th>
                  <th className="!text-left">状态</th>
                  <th className="!text-left">裁决</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((d, i) => (
                  <tr key={d.id ?? i}>
                    <td className="!text-left font-medium text-[var(--foreground)]">{d.expertName ?? '—'}</td>
                    <td className="!text-left text-[var(--muted-foreground)]">{d.type ?? '—'}</td>
                    <td className="!text-left max-w-[280px]" title={d.content ?? undefined}>
                      <span className="font-medium text-[var(--foreground)]">{d.title}</span>
                      {d.content ? <span className="block truncate text-[var(--muted-foreground)]">{d.content}</span> : null}
                    </td>
                    <td className="!text-left">{d.status ?? '—'}</td>
                    <td className="!text-left text-[var(--muted-foreground)]">
                      {d.resolvedAt ? `${d.resolvedBy ?? ''} ${formatDateTime(d.resolvedAt)}` : '未裁决'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 动议 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--foreground)]">动议（{motions.length}）</div>
        {motions.length === 0 ? (
          <EmptyHint text="本项目无动议记录" />
        ) : (
          <div className="space-y-2">
            {motions.map((m, i) => (
              <div key={m.id ?? i} className="wb-note px-3.5 py-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--foreground)]">{m.title ?? '（无标题）'}</span>
                  <span className="wb-status-pill" style={{ '--tone': 'var(--accent)' } as React.CSSProperties}>{m.status ?? '—'}</span>
                  {m.result && <span className="text-[var(--muted-foreground)]">结果：{m.result}</span>}
                </div>
                {m.description && <div className="mt-1 text-[var(--muted-foreground)]">{m.description}</div>}
                {(m.votes?.length ?? 0) > 0 && (
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                    {m.votes!.map((v, j) => (
                      <div key={j}>
                        {v.expertName ?? '（专家）'}：{v.vote ?? '—'}{v.reason ? `（${v.reason}）` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 澄清 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--foreground)]">澄清（{clarifications.length}）</div>
        {clarifications.length === 0 ? (
          <EmptyHint text="本项目无澄清记录" />
        ) : (
          <div className="overflow-x-auto rounded-[12px]">
            <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
              <thead>
                <tr>
                  <th className="!text-left">供应商</th>
                  <th className="!text-left">问题</th>
                  <th className="!text-left">答复</th>
                  <th className="!text-left">答复证据链</th>
                </tr>
              </thead>
              <tbody>
                {clarifications.map((c, i) => (
                  <tr key={c.id ?? i}>
                    <td className="!text-left font-medium text-[var(--foreground)]">{c.supplierName ?? '—'}</td>
                    <td className="!text-left max-w-[240px] truncate" title={c.question ?? undefined}>{c.question ?? '—'}</td>
                    <td className="!text-left max-w-[240px] truncate" title={c.reply ?? undefined}>{c.reply ?? '待答复'}</td>
                    <td className="!text-left text-[var(--muted-foreground)]">
                      {c.replyChannel ? (
                        <span title={`SM2 签名 ${c.replySignature ?? ''}`}>
                          {c.replyChannel}
                          {c.replySignature ? ` · ${shortHash(c.replySignature)}` : ''}
                          {(c.replyAttachmentIds?.length ?? 0) > 0 ? ` · 附件×${c.replyAttachmentIds!.length}` : ''}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 条款裁定 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-[var(--foreground)]">条款裁定（{reviews.length}）</div>
        {reviews.length === 0 ? (
          <EmptyHint text="本项目无条款裁定记录" />
        ) : (
          <div className="overflow-x-auto rounded-[12px]">
            <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
              <thead>
                <tr>
                  <th className="!text-left">专家</th>
                  <th className="!text-left">供应商</th>
                  <th className="!text-left">条款</th>
                  <th className="!text-left">类别</th>
                  <th className="!text-left">裁定</th>
                  <th className="!text-left">备注</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r, i) => (
                  <tr key={i}>
                    <td className="!text-left font-medium text-[var(--foreground)]">{r.expertName ?? '—'}</td>
                    <td className="!text-left">{r.supplierName ?? '—'}</td>
                    <td className="!text-left font-mono text-[11px] text-[var(--muted-foreground)]">{r.requirementId ?? '—'}</td>
                    <td className="!text-left text-[var(--muted-foreground)]">{r.category ?? '—'}</td>
                    <td className="!text-left font-semibold text-[var(--foreground)]">{r.verdict ?? '—'}</td>
                    <td className="!text-left max-w-[220px] truncate text-[var(--muted-foreground)]" title={r.note ?? undefined}>{r.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoSection({ pkg }: { pkg: HandoverPackage }) {
  const memos = pkg.expertMemos ?? [];
  if (memos.length === 0) return <EmptyHint text="本项目无专家备忘" />;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {memos.map((m, i) => (
        <div key={i} className="wb-note px-3.5 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">{m.expertName ?? '（专家）'}</span>
            {m.supplierName && <span>· {m.supplierName}</span>}
            {(m.scoreItemName || m.scorePointName) && (
              <span>· {[m.scoreItemName, m.scorePointName].filter(Boolean).join(' / ')}</span>
            )}
            <span className="ml-auto tabular-nums">{formatDateTime(m.createdAt)}</span>
          </div>
          {m.contentText && <div className="mt-1.5 leading-relaxed text-[var(--foreground)]">{m.contentText}</div>}
          {m.ink && (
            <div className="mt-1.5 font-mono text-[10px] text-[var(--muted-foreground)]" title={`笔迹图 ${m.ink.fileAssetId}`}>
              手写笔迹留档 · sha256 {shortHash(m.ink.sha256)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AiSection({ pkg }: { pkg: HandoverPackage }) {
  const ai = pkg.aiAnalysis;
  if (!ai) return <EmptyHint text="本项目无 AI 辅助评标记录" />;
  const bidders = ai.bidders ?? [];
  const report = ai.report ?? null;
  const rs = report?.riskStats ?? null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span>
          分析状态 <span className="font-semibold text-[var(--foreground)]">{ai.status ?? '—'}</span>
        </span>
        <span>
          来源凭证 <span className="text-[var(--foreground)]">{ai.aiProvenance ? '已记录' : '未记录'}</span>
        </span>
      </div>

      {bidders.length > 0 && (
        <div className="overflow-x-auto rounded-[12px]">
          <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
            <thead>
              <tr>
                <th className="!text-left">供应商</th>
                <th className="!text-left">资格性</th>
                <th className="!text-left">AI 风险</th>
                <th className="!text-right">AI 评分</th>
                <th className="!text-left">分析时间</th>
              </tr>
            </thead>
            <tbody>
              {bidders.map((b, i) => {
                const risk = RISK_TONES[b.riskLevel ?? ''] ?? { label: b.riskLevel ?? '—', tone: 'var(--muted-foreground)' };
                return (
                  <tr key={i}>
                    <td className="!text-left font-medium text-[var(--foreground)]">{b.supplierName ?? '—'}</td>
                    <td className="!text-left">{b.qualificationStatus ?? '—'}</td>
                    <td className="!text-left">
                      <span className="wb-status-pill" style={{ '--tone': risk.tone } as React.CSSProperties}>{risk.label}</span>
                    </td>
                    <td className="!text-right font-mono tabular-nums">{b.totalScore != null ? Number(b.totalScore).toFixed(2) : '—'}</td>
                    <td className="!text-left tabular-nums text-[var(--muted-foreground)]">{formatDateTime(b.processedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <div className="wb-note px-3.5 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold text-[var(--foreground)]">汇总报告</span>
            <span className="text-[var(--muted-foreground)]">{formatDateTime(report.generatedAt)}</span>
            {rs && (
              <span className="ml-auto inline-flex items-center gap-2">
                <span>高<span className="font-mono font-semibold text-[var(--danger)]">{rs.highCount ?? 0}</span></span>
                <span>中<span className="font-mono font-semibold text-[var(--warning)]">{rs.mediumCount ?? 0}</span></span>
                <span>低<span className="font-mono font-semibold text-[var(--accent)]">{rs.lowCount ?? 0}</span></span>
                {rs.fraudRiskLevel && (
                  <span className="wb-status-pill" style={{ '--tone': RISK_TONES[rs.fraudRiskLevel]?.tone ?? 'var(--muted-foreground)' } as React.CSSProperties}>
                    围串标风险 {RISK_TONES[rs.fraudRiskLevel]?.label ?? rs.fraudRiskLevel}
                  </span>
                )}
              </span>
            )}
          </div>
          {report.conclusion && (
            <div className="mt-1.5 whitespace-pre-wrap leading-relaxed text-[var(--foreground)]">{report.conclusion}</div>
          )}
          {report.recommendation && (
            <div className="mt-1.5 text-[var(--muted-foreground)]">建议：{report.recommendation}</div>
          )}
          {(report.docx || report.pdf) && (
            <div className="mt-2 flex flex-wrap gap-3">
              {report.docx && (
                <a
                  href={`/api/upload/files/${report.docx.fileAssetId}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] hover:underline"
                  title={`sha256 ${report.docx.sha256 ?? ''}`}
                >
                  <Download size={11} /> {report.docx.originalName ?? 'AI 分析报告 DOCX'}（{shortHash(report.docx.sha256)}）
                </a>
              )}
              {report.pdf && (
                <a
                  href={`/api/upload/files/${report.pdf.fileAssetId}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] hover:underline"
                  title={`sha256 ${report.pdf.sha256 ?? ''}`}
                >
                  <Download size={11} /> {report.pdf.originalName ?? 'AI 分析报告 PDF'}（{shortHash(report.pdf.sha256)}）
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SupervisionSection({ pkg }: { pkg: HandoverPackage }) {
  const logs = pkg.supervisionLogs ?? [];
  if (logs.length === 0) return <EmptyHint text="本项目无监督日志" />;
  return (
    <div className="overflow-x-auto rounded-[12px]">
      <table className="neu-table !text-xs [&_td]:!py-1.5 [&_th]:!py-2">
        <thead>
          <tr>
            <th className="!text-left">时间</th>
            <th className="!text-left">角色</th>
            <th className="!text-left">动作</th>
            <th className="!text-left">对象</th>
            <th className="!text-left">结果</th>
            <th className="!text-left">风险标记</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => {
            const tone = riskFlagTone(l.riskFlag);
            return (
              <tr key={i}>
                <td className="!text-left whitespace-nowrap tabular-nums text-[var(--muted-foreground)]">{formatDateTime(l.time)}</td>
                <td className="!text-left whitespace-nowrap">{l.role ?? '—'}</td>
                <td className="!text-left font-medium text-[var(--foreground)]">{l.action ?? '—'}</td>
                <td className="!text-left max-w-[180px] truncate text-[var(--muted-foreground)]" title={l.target ?? undefined}>{l.target ?? '—'}</td>
                <td className="!text-left max-w-[280px] truncate text-[var(--muted-foreground)]" title={l.result ?? undefined}>{l.result ?? '—'}</td>
                <td className="!text-left">
                  {tone ? (
                    <span className="wb-status-pill font-semibold" style={{ '--tone': tone } as React.CSSProperties}>{l.riskFlag}</span>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">{l.riskFlag ?? '—'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">共 {logs.length} 条，开评标全周期留痕；风险标记非「无」时着色</div>
    </div>
  );
}

/* ── 主组件：查验内容入口 + 展开区 ── */

export function HandoverPreview({ downloadUrl }: { downloadUrl: string }) {
  const [open, setOpen] = useState(false);
  const [pkg, setPkg] = useState<HandoverPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const hasPkgRef = useRef(false);

  const load = useCallback(
    (force = false) => {
      if (loadingRef.current) return;
      if (!force && loadedUrlRef.current === downloadUrl && hasPkgRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      fetch(downloadUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`回流包拉取失败（HTTP ${res.status}）`);
          return res.json() as Promise<HandoverPackage>;
        })
        .then((j) => {
          loadedUrlRef.current = downloadUrl;
          hasPkgRef.current = true;
          setPkg(j);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '回流包拉取失败');
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
        });
    },
    [downloadUrl],
  );

  // 首次展开才发起（220KB 级 JSON 不随面板 30s 轮询重拉）
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="neu-btn-soft !h-[32px] !text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
          <FileSearch size={13} /> {open ? '收起查验' : '查验内容'}
        </button>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          结构化预览签字与身份核验、评分快照、澄清/异议/动议、专家备忘、AI 辅助与监督日志（只读）
        </span>
        {open && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="neu-btn-xs"
              onClick={() => load(true)}
              disabled={loading}
              title="回流包重生成后同 URL 覆盖，强制重拉最新内容"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新加载
            </button>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener"
              className="neu-btn-xs"
              title="下载原始 JSON（与上方下载链接同一对象）"
            >
              <Download size={12} /> 原始 JSON
            </a>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-2.5 space-y-2.5">
          {loading && !pkg && (
            <div className="wb-note px-3.5 py-4 text-center text-xs text-[var(--muted-foreground)]">
              正在拉取评标回流包（~220KB）…
            </div>
          )}
          {error && (
            <div className="wb-tone-banner wb-tone-banner--danger text-xs">
              <AlertTriangle size={13} />
              <span className="font-semibold">{error}</span>
              <button type="button" className="neu-btn-xs ml-auto" onClick={() => load(true)}>
                重试
              </button>
            </div>
          )}
          {pkg && (
            <div className="space-y-2.5">
              {pkg.packageType !== undefined && pkg.packageType !== 'BID_EVALUATION_SIGN_HANDOVER' && (
                <div className="wb-tone-banner wb-tone-banner--warning text-xs">
                  <AlertTriangle size={13} />
                  <span>包类型为 {pkg.packageType ?? '未知'}（预期 BID_EVALUATION_SIGN_HANDOVER），以下为兼容渲染</span>
                </div>
              )}
              <Section icon={<ClipboardCheck size={14} />} title="概要与排名" hint="包内快照，核卷基准">
                <SummarySection pkg={pkg} />
              </Section>
              <Section icon={<PenLine size={14} />} title="签字与身份核验" hint={`${(pkg.expertSignStatuses ?? []).length} 人`}>
                <SignSection pkg={pkg} />
              </Section>
              <Section icon={<Sigma size={14} />} title="评分快照" hint="evaluationSnapshot v2">
                <ScoreSnapshotSection pkg={pkg} />
              </Section>
              <Section icon={<MessagesSquare size={14} />} title="澄清 · 异议 · 动议 · 条款裁定">
                <ProcessRecordsSection pkg={pkg} />
              </Section>
              <Section icon={<StickyNote size={14} />} title="专家备忘" hint={`${(pkg.expertMemos ?? []).length} 条`}>
                <MemoSection pkg={pkg} />
              </Section>
              <Section icon={<Bot size={14} />} title="AI 辅助评标">
                <AiSection pkg={pkg} />
              </Section>
              <Section icon={<ScrollText size={14} />} title="监督日志" hint={`${(pkg.supervisionLogs ?? []).length} 条`} defaultOpen={false}>
                <SupervisionSection pkg={pkg} />
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
