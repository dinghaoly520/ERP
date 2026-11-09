'use client';

import { useEffect, useState } from 'react';
import { getApprovalHistory } from '@/lib/api/supplier';
import type { ApprovalRecord } from '@/lib/api/supplier';
import type { SupplierChangeRecord } from '@/lib/types';
import { ApprovalTimeline } from '@/components/workbench/approval-timeline';
import { StatusBadge } from '@/components/workbench';
import { CopyIconButton } from '@/components/copy-icon-button';
import { Loader2, CheckCircle2, XCircle, RotateCcw, FileEdit, FileText, Paperclip } from 'lucide-react';

/**
 * 审核与变更记录（2026-11-09 用户裁定）：注册审核留痕（ApprovalRecord）与资料变更
 * （SupplierChangeRecord）合并为一张卡内的单列时间流——同一套行样式按时间倒序混排，
 * 点击行展开各自详情（审核 → 申请快照；变更 → 新旧值 + 审批时间线）。
 * 取代旧「审核历史」卡列表 + 「资料变更记录」表格两节分立形态。
 */

/** 快照日期格式化（ISO 字符串 → zh-CN 日期）；空值/非法值返回空串由调用侧兜底 */
function fmtDate(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
}

function fmtDateTime(v: string) {
  const d = new Date(v);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ACTION_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  APPROVED: { label: '审核通过', color: 'var(--success)', icon: CheckCircle2 },
  REJECTED: { label: '审核不通过', color: 'var(--danger)', icon: XCircle },
  RETURNED: { label: '退回补正', color: 'var(--warning)', icon: RotateCcw },
};

const CHANGE_STATUS: Record<string, { label: string; tone: 'blue' | 'green' | 'red' | 'gray' }> = {
  PENDING: { label: '待审批', tone: 'blue' },
  APPROVED: { label: '已通过', tone: 'green' },
  REJECTED: { label: '已拒绝', tone: 'red' },
  RETURNED: { label: '已退回', tone: 'gray' },
};

type UnifiedRow =
  | { key: string; kind: 'approval'; at: string; record: ApprovalRecord }
  | { key: string; kind: 'change'; at: string; record: SupplierChangeRecord };

export function ApprovalChangeHistory({
  supplierId,
  supplierName,
  changes,
  onReviewChange,
}: {
  supplierId: string;
  supplierName: string;
  changes: SupplierChangeRecord[];
  /** 待审批变更行内「通过/拒绝」→ 打开页面复核弹窗 */
  onReviewChange: (changeId: string, type: 'approve' | 'reject') => void;
}) {
  const [approvals, setApprovals] = useState<ApprovalRecord[] | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    getApprovalHistory(supplierId).then(setApprovals).catch(() => setApprovals([]));
  }, [supplierId]);

  if (approvals === null) {
    return <div className="py-8 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin mx-auto mb-2" />加载审核与变更记录…</div>;
  }

  const rows: UnifiedRow[] = [
    ...approvals.map(r => ({ key: `a-${r.id}`, kind: 'approval' as const, at: r.createdAt, record: r })),
    ...changes.map(c => ({ key: `c-${c.id}`, kind: 'change' as const, at: c.createdAt, record: c })),
  ].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

  if (rows.length === 0) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无审核与变更记录</p>;

  return (
    <div>
      {rows.map((row, i) => {
        const isExpanded = expandedKey === row.key;
        return (
          <div key={row.key} className={i > 0 ? 'pt-3.5 mt-3.5' : ''} style={i > 0 ? { borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' } : undefined}>
            {row.kind === 'approval' ? (
              <ApprovalRow record={row.record} expanded={isExpanded} onToggle={() => setExpandedKey(isExpanded ? null : row.key)} />
            ) : (
              <ChangeRow
                record={row.record}
                supplierName={supplierName}
                expanded={isExpanded}
                onToggle={() => setExpandedKey(isExpanded ? null : row.key)}
                onReviewChange={onReviewChange}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 注册审核行：结论图标 + 标题 + 代审徽标 + 验证人/理由，展开看申请快照 */
function ApprovalRow({ record: r, expanded, onToggle }: { record: ApprovalRecord; expanded: boolean; onToggle: () => void }) {
  const meta = ACTION_META[r.action] || { label: r.action, color: 'var(--muted-foreground)', icon: FileText };
  const Icon = meta.icon;
  return (
    <div className={`-mx-2 cursor-pointer rounded-xl px-2 py-1.5 transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] ${expanded ? 'bg-[color-mix(in_oklch,var(--foreground)_2%,transparent)]' : ''}`} onClick={onToggle}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${meta.color} 14%, transparent)`, color: meta.color }}>
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--muted-foreground)]">注册审核</span>
            <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
            {/* 代审徽标（A 方案 2026-10-08；2026-10-09 扩）：公司无在编 leader→admin 代复审、
                无在编 staff→leader 代初审、无在编办公账号→admin 代初审 */}
            {r.stage === 'LEADER' && r.reviewer?.role === 'admin' && (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]" title="归属公司无在编 leader，平台 admin 代复审">代复审</span>
            )}
            {r.stage === 'STAFF' && (r.reviewer?.role === 'leader' || r.reviewer?.role === 'admin') && (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]"
                title={r.reviewer?.role === 'leader' ? '归属公司无在编 staff，同公司 leader 代初审' : '归属公司无在编办公账号，平台 admin 代初审'}>代初审</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            验证人：{r.reviewer?.displayName || r.reviewer?.username || '—'} · {fmtDateTime(r.createdAt)}{r.reason ? ` · 理由：${r.reason}` : ''}
          </div>
        </div>
        <Chevron open={expanded} />
      </div>

      {expanded && <SnapshotDetail record={r} />}
    </div>
  );
}

/** 资料变更行：字段 + 状态徽标 + 新旧值摘要，待审批行内给通过/拒绝；展开看审批时间线 */
function ChangeRow({ record: c, supplierName, expanded, onToggle, onReviewChange }: {
  record: SupplierChangeRecord;
  supplierName: string;
  expanded: boolean;
  onToggle: () => void;
  onReviewChange: (changeId: string, type: 'approve' | 'reject') => void;
}) {
  const isConvert = c.fieldName === 'convertToRegular';
  const st = CHANGE_STATUS[c.status] || { label: c.status, tone: 'gray' as const };
  const newVal = isConvert ? '企业资料+联系人+资质' : (c.newValue || '—');
  return (
    <div className={`-mx-2 cursor-pointer rounded-xl px-2 py-1.5 transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] ${expanded ? 'bg-[color-mix(in_oklch,var(--foreground)_2%,transparent)]' : ''}`} onClick={onToggle}>
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]">
          <FileEdit size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--muted-foreground)]">资料变更</span>
            <span className="text-sm font-bold text-[var(--foreground)]">{c.fieldLabel || '资料信息'}</span>
            {isConvert && (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_15%,transparent)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent)]">转正</span>
            )}
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
            {supplierName} 提交 · {fmtDateTime(c.createdAt)} · {c.oldValue || '—'} → {newVal}
          </div>
        </div>
        {c.status === 'PENDING' && (
          <div className="flex shrink-0 gap-1.5" onClick={e => e.stopPropagation()}>
            <button onClick={() => onReviewChange(c.id, 'approve')} className="neu-btn-xs is-success">通过</button>
            <button onClick={() => onReviewChange(c.id, 'reject')} className="neu-btn-xs is-danger">拒绝</button>
          </div>
        )}
        <Chevron open={expanded} />
      </div>

      {expanded && (
        <div className="mt-3 rounded-xl bg-[color-mix(in_oklch,var(--foreground)_1.5%,transparent)] px-4 py-3">
          {c.reason && <p className="mb-2.5 text-xs text-[var(--muted-foreground)]">变更原因：{c.reason}</p>}
          <ApprovalTimeline compact events={[
            { action: '提交变更申请', actor: supplierName, time: c.createdAt, note: c.reason, outcome: 'pending' as const },
            ...(c.status !== 'PENDING' ? [{
              action: c.status === 'APPROVED' ? '审批通过' : '审批拒绝',
              // S10 终稿：后端已 enrich reviewedByName；reviewedBy（user id）仅作历史数据兜底经形状守卫隐藏
              actor: (c as any).reviewedByName ?? ((typeof c.reviewedBy === 'string' && /^[a-z0-9]{20,}$/.test(c.reviewedBy)) ? undefined : (c.reviewedBy ?? undefined)),
              time: c.reviewedAt ?? null,
              note: c.rejectReason ?? null,
              outcome: c.status === 'APPROVED' ? 'approved' as const : 'rejected' as const,
            }] : []),
          ]} />
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
  );
}

/** 申请快照（注册 2.0 全量留痕，自旧 ApprovalHistory 展开块平移） */
function SnapshotDetail({ record: r }: { record: ApprovalRecord }) {
  return (
    <div className="mt-3 rounded-xl bg-[color-mix(in_oklch,var(--foreground)_1.5%,transparent)] px-4 py-4">
      {/* logo（旧快照无此字段则不渲染） */}
      {r.snapshot.logoUrl && (
        <img src={r.snapshot.logoUrl} alt="公司 logo" className="mb-3 h-12 w-12 rounded-lg bg-[var(--muted)]/20 object-cover" />
      )}
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <SnapshotItem label="企业名称" value={r.snapshot.name} />
        <SnapshotItem label="供应商编号" value={r.snapshot.supplierNo} mono />
        <SnapshotItem label="统一社会信用代码" value={r.snapshot.creditCode} mono copyable />
        <SnapshotItem label="机构代码" value={r.snapshot.organizationCode} mono copyable />
        <SnapshotItem label="企业类型" value={r.snapshot.enterpriseType} />
        <SnapshotItem label="所属行业" value={r.snapshot.industry} />
        <SnapshotItem label="法定代表人" value={r.snapshot.legalPerson} />
        <SnapshotItem label="法定代表人身份证号" value={r.snapshot.legalPersonIdCard} mono copyable />
        <SnapshotItem label="法人联系电话" value={r.snapshot.legalPersonPhone} mono copyable />
        <SnapshotItem label="注册资本" value={r.snapshot.registeredCapital} />
        <SnapshotItem label="国别" value={r.snapshot.country} />
        <SnapshotItem label="行政区域" value={r.snapshot.region} />
        <SnapshotItem label="公司邮箱" value={r.snapshot.companyEmail} copyable />
        <SnapshotItem label="公司官网" value={r.snapshot.companyWebsite} />
        <SnapshotItem label="注册地址" value={r.snapshot.registeredAddress} full />
        <SnapshotItem label="详细地址" value={r.snapshot.detailedAddress} full />
        <SnapshotItem label="经营范围" value={r.snapshot.businessScope} full />
        <SnapshotItem label="业务标签" value={r.snapshot.tags?.join('、')} full />
        <SnapshotItem label="注册类型" value={r.snapshot.isTemporary ? '临时供应商' : '正式供应商'} />
      </dl>

      <div className="mt-3 pt-3" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">联系人</p>
        <div className="space-y-1">
          {(r.snapshot.contacts ?? []).map((c, i) => (
            <div key={i} className="text-xs text-[var(--muted-foreground)]">
              {c.name}{c.gender ? ` · ${c.gender}` : ''} · {c.phone}{c.idCard ? ` · 身份证 ${c.idCard}` : ''}{c.isPrimary ? ' · 主要' : ''}{c.position ? ` · ${c.position}` : ''}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">资质材料（{(r.snapshot.qualifications ?? []).length}）</p>
        <div className="space-y-1">
          {(r.snapshot.qualifications ?? []).map((q, i) => (
            <div key={i} className="text-xs text-[var(--muted-foreground)]">
              {q.type} · {q.name}{q.validFrom || q.validTo ? ` · ${fmtDate(q.validFrom) || '…'} ~ ${fmtDate(q.validTo) || '…'}` : ''}
              {(q.fileUrl || (Array.isArray(q.attachments) && q.attachments.length > 0)) && (
                <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {q.fileUrl && (
                    <a href={q.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">资质文件</a>
                  )}
                  {Array.isArray(q.attachments) && q.attachments.map((att, j) => (
                    <a key={j} href={att.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">
                      <Paperclip size={10} />{att.name || `附件 ${j + 1}`}
                    </a>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 银行账户（旧快照无此块则不渲染） */}
      {Array.isArray(r.snapshot.bankAccounts) && r.snapshot.bankAccounts.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">银行账户（{r.snapshot.bankAccounts.length}）</p>
          <div className="space-y-1">
            {r.snapshot.bankAccounts.map((b, i) => (
              <div key={b.id || i} className="text-xs text-[var(--muted-foreground)]">
                {b.accountName} · {b.bankName}{b.bankBranch ? ` · ${b.bankBranch}` : ''} · <span className="font-mono">{b.accountNo}</span>{b.isDefault ? ' · 默认' : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 主体业绩（旧快照无此块则不渲染） */}
      {Array.isArray(r.snapshot.performances) && r.snapshot.performances.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">主体业绩（{r.snapshot.performances.length}）</p>
          <div className="space-y-1">
            {r.snapshot.performances.map((p, i) => (
              <div key={p.id || i} className="text-xs text-[var(--muted-foreground)]">
                {p.projectName}{p.clientName ? ` · ${p.clientName}` : ''}{p.contractAmount ? ` · ${p.contractAmount}` : ''}{p.signDate ? ` · ${fmtDate(p.signDate) || '…'}` : ''}
                {Array.isArray(p.proofFiles) && p.proofFiles.length > 0 && (
                  <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {p.proofFiles.map((f, j) => (
                      <a key={j} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">
                        <Paperclip size={10} />{f.name || `证明材料 ${j + 1}`}
                      </a>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SnapshotItem({ label, value, mono = false, full = false, copyable = false }: { label: string; value?: string | null; mono?: boolean; full?: boolean; copyable?: boolean }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <dt className="text-[11px] text-[var(--muted-foreground)]">{label}</dt>
      <dd className={`flex items-center gap-1 text-[13px] font-semibold text-[var(--foreground)] ${mono ? 'font-mono' : ''}`}>
        <span className="break-all">{value || '—'}</span>
        {copyable && value ? <CopyIconButton value={value} label={label} /> : null}
      </dd>
    </div>
  );
}
