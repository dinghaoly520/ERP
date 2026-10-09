'use client';

/**
 * 审核历史窗口（2026-09-30 admin only；2026-10-08 重设计）
 * 按归属公司分类汇总 +「一次完整审批」为行组（用户裁定 2026-10-08）：
 * - 公司分组头（CompanySectionHeader，与供应商管理/专家管理同款）统计各公司轮数
 * - 组内按 供应商×审批轮次 分块：终审通过或驳回即闭环一轮；退回补正及其后的补正重审算
 *   同一轮（补正后回到原级继续）；驳回复活重审开启新一轮
 * - 块内记录倒序（终审在上），列：动作 | 操作人 | 缘由/原因 | 时间
 * - 代审徽标（A 方案 2026-10-08）：LEADER 级被 admin 完成=「代复审」、STAFF 级被 leader
 *   完成=「代初审」——防「采购中心管理员担任复审」再次被误读
 * 入口：审批窗口右上角「审核历史」按钮（Modal headerExtra）。
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, Search } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { listAllApprovalRecords, type AllApprovalRecord } from '@/lib/api/supplier';
import { CompanySectionHeader, buildCompanyCounts, NO_COMPANY } from '@/components/company/company-tag';

const STAGE_LABEL: Record<string, string> = {
  STAFF: '初审',
  LEADER: '复审',
  ADMIN: '终审',
};

type Filter = 'ALL' | 'APPROVED' | 'RETURNED' | 'REJECTED';

/** 一次完整审批（一轮）：同一供应商的一段连续记录，终审通过/驳回闭环 */
interface ApprovalRound {
  key: string;
  supplier: AllApprovalRecord['supplier'];
  /** 块内倒序（最新=终审在上） */
  records: AllApprovalRecord[];
  outcome: { label: string; tone: 'green' | 'red' | 'orange' | 'neutral' };
}

/** 按供应商拆轮次：时间正序走，终审通过（APPROVED·ADMIN）或驳回（REJECTED）闭环一轮；
 *  退回补正不闭环（补正后回到原级继续，算同一轮）。返回各轮均倒序。 */
function splitRounds(records: AllApprovalRecord[], supplier: AllApprovalRecord['supplier']): ApprovalRound[] {
  const asc = [...records].reverse();
  const chunks: AllApprovalRecord[][] = [];
  let cur: AllApprovalRecord[] = [];
  for (const r of asc) {
    cur.push(r);
    if ((r.action === 'APPROVED' && r.stage === 'ADMIN') || r.action === 'REJECTED') {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur); // 未闭环轮（在审/待补正）
  return chunks.map((rs, i) => ({
    key: `${supplier.id}:${i}`,
    supplier,
    records: [...rs].reverse(),
    outcome: roundOutcome(rs),
  }));
}

function roundOutcome(ascRecords: AllApprovalRecord[]): ApprovalRound['outcome'] {
  if (ascRecords.some(r => r.action === 'APPROVED' && r.stage === 'ADMIN')) return { label: '终审通过 · 已入库', tone: 'green' };
  if (ascRecords.some(r => r.action === 'REJECTED')) return { label: '已驳回', tone: 'red' };
  const last = ascRecords[ascRecords.length - 1];
  if (last?.action === 'RETURNED') return { label: '退回待补正', tone: 'orange' };
  return { label: '审核中', tone: 'neutral' };
}

function actionLabel(r: AllApprovalRecord): string {
  const st = r.stage && STAGE_LABEL[r.stage] ? STAGE_LABEL[r.stage] : null;
  if (r.action === 'APPROVED') return st ? `${st}通过` : '通过';
  if (r.action === 'REJECTED') return st ? `${st}驳回` : '驳回';
  return st ? `${st}退回补正` : '退回补正';
}

function actionTone(r: AllApprovalRecord): 'green' | 'orange' | 'red' {
  return r.action === 'APPROVED' ? 'green' : r.action === 'RETURNED' ? 'orange' : 'red';
}

const toneCls: Record<string, string> = {
  green: 'text-[var(--success)] bg-[color-mix(in_oklch,var(--success)_12%,transparent)]',
  orange: 'text-[var(--warning)] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]',
  red: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)]',
  neutral: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]',
};

/** 代审徽标（A 方案）：公司无在编 leader 时 admin 代复审；无在编 staff 时 leader 代初审、
 *  公司无在编办公账号（无 staff 且无 leader）时 admin 代初审（2026-10-09 扩）。 */
function SubstitutionBadge({ stage, reviewerRole }: { stage?: string | null; reviewerRole?: string }) {
  if (stage === 'LEADER' && reviewerRole === 'admin') {
    return <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]">代复审</span>;
  }
  if (stage === 'STAFF' && (reviewerRole === 'leader' || reviewerRole === 'admin')) {
    return <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold text-[var(--accent)]">代初审</span>;
  }
  return null;
}

export function ApprovalHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<AllApprovalRecord[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- 关闭重开重置上次筛选/搜索（受控重置，与 review-center-modal 同模式） */
    setRecords(null);
    setFilter('ALL');
    setSearch('');
    /* eslint-enable react-hooks/set-state-in-effect */
    listAllApprovalRecords().then(setRecords).catch(() => setRecords([]));
  }, [open]);

  /* 记录 → 供应商分组 → 拆轮次 → 公司分组 */
  const companies = useMemo(() => {
    if (!records) return null;
    const bySupplier = new Map<string, AllApprovalRecord[]>();
    for (const r of records) {
      const list = bySupplier.get(r.supplier.id) ?? [];
      list.push(r);
      bySupplier.set(r.supplier.id, list); // records 已倒序，组内保持倒序
    }
    const rounds: ApprovalRound[] = [];
    for (const rs of bySupplier.values()) {
      rounds.push(...splitRounds(rs, rs[0].supplier));
    }
    // 公司分组：buildCompanyCounts 定序（count 降序、未归属垫底）
    const groups = buildCompanyCounts(rounds.map(r => ({ company: r.supplier.companyName })));
    return groups.map(g => ({
      name: g.name,
      rounds: rounds.filter(r => ((r.supplier.companyName ?? '').trim() || NO_COMPANY) === g.name),
    }));
  }, [records]);

  const filtered = useMemo(() => {
    if (!companies) return null;
    const q = search.trim().toLowerCase();
    return companies
      .map(g => ({
        name: g.name,
        rounds: g.rounds.filter(r => {
          if (filter !== 'ALL' && !r.records.some(rec => rec.action === filter)) return false;
          if (!q) return true;
          return r.supplier.name.toLowerCase().includes(q)
            || (r.supplier.creditCode ?? '').toLowerCase().includes(q)
            || (r.supplier.companyName ?? '').toLowerCase().includes(q);
        }),
      }))
      .filter(g => g.rounds.length > 0);
  }, [companies, filter, search]);

  const roundCount = filtered?.reduce((n, g) => n + g.rounds.length, 0) ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="审核历史"
      description={filtered ? `全流程审批记录 · ${filtered.length} 家公司 · ${roundCount} 轮` : '全流程审批记录'}
      size="xl"
    >
      {/* 筛选 + 搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="neu-segment rc-segment-inline" role="group" aria-label="按动作筛选"
          style={{ '--segs': 4 } as React.CSSProperties}
          data-index={String(['ALL', 'APPROVED', 'RETURNED', 'REJECTED'].indexOf(filter))}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {([
            { key: 'ALL', label: '全部' },
            { key: 'APPROVED', label: '通过' },
            { key: 'RETURNED', label: '退回补正' },
            { key: 'REJECTED', label: '驳回' },
          ] as const).map(f => (
            <button key={f.key} type="button" className="neu-segment-btn" aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-[220px] shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索供应商 / 信用代码 / 公司" className="neu-input neu-input-sm !pl-8 !h-[32px] !text-xs" />
        </div>
      </div>

      {/* 公司分组 × 轮次块 */}
      {filtered === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />加载审核记录…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
          <History size={20} className="opacity-50" />
          暂无符合条件的审批记录
        </div>
      ) : (
        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          {filtered.map(g => (
            <section key={g.name} aria-label={`公司分组 ${g.name}`}>
              <CompanySectionHeader name={g.name} count={g.rounds.length} suffix="轮审批" />
              <div className="mt-1.5 flex flex-col gap-2">
                {g.rounds.map(round => (
                  <div key={round.key} className="overflow-hidden rounded-xl border border-[var(--border)]">
                    {/* 块头：供应商（跨整轮）+ 轮次结论 */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--foreground)_2%,transparent)] px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold text-[var(--foreground)]" title={round.supplier.name}>{round.supplier.name}</div>
                        <div className="truncate font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{round.supplier.creditCode || '—'}</div>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${toneCls[round.outcome.tone]}`}>
                        {round.outcome.label}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">{round.records.length} 条</span>
                    </div>
                    {/* 列头 + 记录行 */}
                    <div className="grid min-w-[760px] grid-cols-[130px_140px_1fr_160px] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <div className="px-3 py-1.5">动作</div>
                      <div className="px-3 py-1.5">操作人</div>
                      <div className="px-3 py-1.5">缘由 / 原因</div>
                      <div className="px-3 py-1.5 text-right">时间</div>
                    </div>
                    {round.records.map(r => (
                      <div key={r.id} className="grid min-w-[760px] grid-cols-[130px_140px_1fr_160px] items-center border-b border-[color-mix(in_oklch,var(--border)_60%,transparent)] last:border-b-0 hover:bg-[color-mix(in_oklch,var(--foreground)_2%,transparent)]">
                        <div className="flex flex-wrap items-center gap-1 px-3 py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${toneCls[actionTone(r)]}`}>
                            {actionLabel(r)}
                          </span>
                          <SubstitutionBadge stage={r.stage} reviewerRole={r.reviewer?.role} />
                        </div>
                        <div className="px-3 py-2 text-[12px] text-[var(--foreground)]">{r.reviewer?.displayName || '—'}</div>
                        <div className="max-w-[320px] px-3 py-2">
                          <span className="block truncate text-[12px] text-[var(--muted-foreground)]" title={r.reason ?? ''}>{r.reason || '—'}</span>
                          {(r.attachmentIds ?? []).length > 0 && (
                            <span className="mt-0.5 block font-mono text-[10px] text-[var(--accent)]">📎 {r.attachmentIds!.length} 个附件（详情见审批窗口）</span>
                          )}
                        </div>
                        <div className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                          {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
