'use client';

import { Info } from 'lucide-react';
import type { AiBidAnalysisTask, AiBidder } from '@/lib/types/ai-bid-analysis';

interface AiKeyInfoPanelProps {
  taskId: string;
  task: AiBidAnalysisTask;
  section?: 'qualification' | 'performance' | 'price' | 'contact';
}

// ── Comparison table types ──

type CellVariant = 'normal' | 'highlight' | 'missing' | 'warning';

type ComparisonCell = {
  value: React.ReactNode;
  variant?: CellVariant;
  badge?: string;
  badgeTone?: 'green' | 'blue' | 'amber' | 'red';
};

type ComparisonRow = {
  label: string;
  cells: ComparisonCell[];
};

type ComparisonTableProps = {
  headers: string[];
  rows: ComparisonRow[];
  headerBadges?: (string | null)[];
};

// ── Helpers ──

function fmt(value: React.ReactNode): React.ReactNode {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

function cellClasses(variant: CellVariant = 'normal') {
  switch (variant) {
    case 'highlight': return 'font-semibold text-blue-700';
    case 'missing': return 'text-slate-400 italic';
    case 'warning': return 'font-medium text-rose-700';
    default: return 'text-slate-800';
  }
}

function cellBg(variant: CellVariant = 'normal', isEven: boolean) {
  if (variant === 'missing') return 'bg-amber-50/40';
  return isEven ? 'bg-slate-50/40' : '';
}

function badgeClasses(tone: ComparisonCell['badgeTone'] = 'blue') {
  const map: Record<NonNullable<ComparisonCell['badgeTone']>, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return map[tone];
}

function renderCell(cell: ComparisonCell) {
  return (
    <>
      {cell.badge && (
        <span className={`mr-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${badgeClasses(cell.badgeTone)}`}>
          {cell.badge}
        </span>
      )}
      <span>{fmt(cell.value)}</span>
    </>
  );
}

// ── ComparisonTable ──

function ComparisonTable({ headers, rows, headerBadges }: ComparisonTableProps) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-2xl">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[110px] min-w-[110px]" />
          {headers.map((_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b-2 border-slate-200">
            <th className="sticky left-0 z-10 bg-white/90 backdrop-blur-sm py-2.5 pr-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              投标单位
            </th>
            {headers.map((name, i) => (
              <th key={i} className="px-3 py-2.5 text-left text-sm font-semibold text-slate-900 border-l border-slate-100/60">
                {name}
                {headerBadges?.[i] && (
                  <span className={`ml-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${badgeClasses(i === 0 ? 'green' : 'blue')}`}>
                    {headerBadges[i]}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isEven = ri % 2 === 1;
            return (
              <tr key={row.label} className={`border-b border-slate-100/60 transition-colors hover:bg-blue-50/20 ${isEven ? 'bg-slate-50/40' : ''}`}>
                <td className={`sticky left-0 z-10 bg-white/90 backdrop-blur-sm py-2.5 pr-3 text-xs font-medium text-slate-500 ${isEven ? '!bg-slate-50/80' : ''}`}>
                  {row.label}
                </td>
                {row.cells.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2.5 border-l border-slate-100/60 ${cellBg(cell.variant, isEven)} ${cellClasses(cell.variant)}`}>
                    {renderCell(cell)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section data builders ──

function QualificationTable({ biddersWithInfo }: { biddersWithInfo: AiBidder[] }) {
  const headers = biddersWithInfo.map((b) => b.name);

  const statusBadgeTone = (s: string | null | undefined): ComparisonCell['badgeTone'] => {
    if (s === '通过') return 'green';
    if (s === '不通过') return 'red';
    return 'amber';
  };

  /** Resolve proposed PM: prefer new field, fallback to legacy projectManager */
  const pm = (b: AiBidder) => b.keyInfo?.proposedProjectManager || b.keyInfo?.projectManager || null;
  const pmTitle = (b: AiBidder) => b.keyInfo?.proposedProjectManagerTitle || b.keyInfo?.projectManagerTitle || null;
  const pmQual = (b: AiBidder) => b.keyInfo?.proposedProjectManagerQualification || null;

  // Only show "执业资格" and "团队人数" rows if at least one bidder has the data
  const hasAnyQualification = biddersWithInfo.some((b) => pmQual(b));
  const hasAnyTeamSize = biddersWithInfo.some((b) => b.keyInfo?.teamSize);

  const rows: ComparisonRow[] = [
    {
      label: '资格审查',
      cells: biddersWithInfo.map((b) => {
        const s = b.keyInfo?.qualificationStatus;
        if (!s) return { value: '-', variant: 'missing' as const };
        return {
          value: s,
          badge: s === '通过' ? '通过' : s === '不通过' ? '不通过' : '待审查',
          badgeTone: statusBadgeTone(s),
        };
      }),
    },
    { label: '资质等级', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.qualificationLevel || null, variant: (!b.keyInfo?.qualificationLevel ? 'missing' : 'highlight') as CellVariant })) },
    { label: '资质名称', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.qualificationName || null, variant: (!b.keyInfo?.qualificationName ? 'missing' : 'normal') as CellVariant })) },
    { label: '注册资本', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.registeredCapital || null, variant: (!b.keyInfo?.registeredCapital ? 'missing' : 'normal') as CellVariant })) },
    { label: '成立日期', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.establishedDate || null, variant: (!b.keyInfo?.establishedDate ? 'missing' : 'normal') as CellVariant })) },
    { label: '法定代表人', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.legalPerson || null, variant: (!b.keyInfo?.legalPerson ? 'missing' : 'normal') as CellVariant })) },
    { label: '拟任项目经理', cells: biddersWithInfo.map((b) => ({ value: pm(b), variant: (!pm(b) ? 'missing' : 'normal') as CellVariant })) },
    { label: '项目经理职称', cells: biddersWithInfo.map((b) => ({ value: pmTitle(b), variant: (!pmTitle(b) ? 'missing' : 'normal') as CellVariant })) },
    ...(hasAnyQualification ? [{ label: '执业资格' as string, cells: biddersWithInfo.map((b) => ({ value: pmQual(b), variant: (!pmQual(b) ? 'missing' : 'normal') as CellVariant })) } satisfies ComparisonRow] : []),
    ...(hasAnyTeamSize ? [{ label: '团队人数' as string, cells: biddersWithInfo.map((b) => {
      const size = b.keyInfo?.teamSize;
      return { value: size ? `${size} 人` : null, variant: (!size ? 'missing' : 'normal') as CellVariant };
    }) } satisfies ComparisonRow] : []),
  ];

  return <ComparisonTable headers={headers} rows={rows} />;
}

function PerformanceTable({ biddersWithInfo }: { biddersWithInfo: AiBidder[] }) {
  const headers = biddersWithInfo.map((b) => b.name);
  const maxCount = Math.max(...biddersWithInfo.map((b) => b.keyInfo?.performanceCount ?? 0), 0);
  const highestCount = maxCount;

  const rows: ComparisonRow[] = [
    {
      label: '业绩数量',
      cells: biddersWithInfo.map((b) => {
        const count = b.keyInfo?.performanceCount ?? 0;
        if (count === 0) return { value: '0', variant: 'missing' as const };
        return { value: count, variant: (count === highestCount && highestCount > 0 ? 'highlight' : 'normal') as CellVariant };
      }),
    },
  ];

  // Add up to 2 key performance rows
  const maxPerfSlots = 2;
  for (let i = 0; i < maxPerfSlots; i++) {
    rows.push({
      label: `重点项目 ${i + 1}`,
      cells: biddersWithInfo.map((b) => {
        const perf = b.keyInfo?.keyPerformances?.[i];
        if (!perf) return { value: null, variant: 'missing' as const };
        const parts = [perf.projectName, perf.contractAmount].filter(Boolean);
        return { value: parts.join(' / '), variant: 'normal' as const };
      }),
    });
  }

  return <ComparisonTable headers={headers} rows={rows} />;
}

function PriceTable({ biddersWithInfo, maxPrice }: { biddersWithInfo: AiBidder[]; maxPrice?: number | null }) {
  // Sort by price ascending (lowest first)
  const sorted = [...biddersWithInfo].sort((a, b) => Number(a.keyInfo?.quotePrice ?? 0) - Number(b.keyInfo?.quotePrice ?? 0));
  const headers = sorted.map((b) => b.name);

  // Determine lowest and over-max
  const lowestId = sorted[0]?.id;
  const headerBadges: (string | null)[] = sorted.map((b) => {
    if (b.id === lowestId && sorted.length > 1) return '最低价';
    return null;
  });

  const rows: ComparisonRow[] = [
    {
      label: '报价',
      cells: sorted.map((b) => {
        const price = b.keyInfo?.quotePrice;
        const priceText = b.keyInfo?.quotePriceYuan || (price ? `${price}万元` : null);
        if (!price) return { value: null, variant: 'missing' as const };
        const exceeds = Boolean(maxPrice && Number(price) > Number(maxPrice));
        if (exceeds) return { value: priceText, variant: 'warning' as const, badge: '超限', badgeTone: 'red' as const };
        if (b.id === lowestId && sorted.length > 1) return { value: priceText, variant: 'highlight' as const };
        return { value: priceText, variant: 'normal' as const };
      }),
    },
    {
      label: '最高限价',
      cells: sorted.map(() => ({ value: maxPrice ? `${maxPrice} 万元` : '-', variant: 'normal' as CellVariant })),
    },
    {
      label: '报价有效',
      cells: sorted.map((b) => {
        const v = b.keyInfo?.priceValidity;
        return { value: v ? `${v} 天` : null, variant: (!v ? 'missing' : 'normal') as CellVariant };
      }),
    },
    {
      label: '工期',
      cells: sorted.map((b) => ({ value: b.keyInfo?.constructionPeriod || null, variant: (!b.keyInfo?.constructionPeriod ? 'missing' : 'normal') as CellVariant })),
    },
    {
      label: '质保期',
      cells: sorted.map((b) => ({ value: b.keyInfo?.warrantyPeriod || null, variant: (!b.keyInfo?.warrantyPeriod ? 'missing' : 'normal') as CellVariant })),
    },
  ];

  return <ComparisonTable headers={headers} rows={rows} headerBadges={headerBadges} />;
}

function ContactTable({ biddersWithInfo }: { biddersWithInfo: AiBidder[] }) {
  const headers = biddersWithInfo.map((b) => b.name);

  const rows: ComparisonRow[] = [
    { label: '电话', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.contactInfo?.phone || null, variant: (!b.keyInfo?.contactInfo?.phone ? 'missing' : 'normal') as CellVariant })) },
    { label: '邮箱', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.contactInfo?.email || null, variant: (!b.keyInfo?.contactInfo?.email ? 'missing' : 'normal') as CellVariant })) },
    { label: '地址', cells: biddersWithInfo.map((b) => ({ value: b.keyInfo?.contactInfo?.address || null, variant: (!b.keyInfo?.contactInfo?.address ? 'missing' : 'normal') as CellVariant })) },
  ];

  return <ComparisonTable headers={headers} rows={rows} />;
}

// ── Main export ──

export default function AiKeyInfoPanel({ task, section }: AiKeyInfoPanelProps) {
  const bidders = task.bidders || [];
  const biddersWithInfo = bidders.filter((b) => b.keyInfo);

  if (biddersWithInfo.length === 0) {
    return (
      <div className="rounded-xl p-4 text-center opacity-50">
        <Info className="mx-auto mb-2 h-8 w-8 opacity-30" />
        <p className="text-sm">暂无关键信息</p>
      </div>
    );
  }

  if (section === 'qualification') return <QualificationTable biddersWithInfo={biddersWithInfo} />;
  if (section === 'performance') return <PerformanceTable biddersWithInfo={biddersWithInfo} />;
  if (section === 'price') return <PriceTable biddersWithInfo={biddersWithInfo} maxPrice={task.requirements?.maxPrice} />;
  if (section === 'contact') return <ContactTable biddersWithInfo={biddersWithInfo} />;

  return (
    <div className="space-y-4">
      <QualificationTable biddersWithInfo={biddersWithInfo} />
      <PerformanceTable biddersWithInfo={biddersWithInfo} />
      <PriceTable biddersWithInfo={biddersWithInfo} maxPrice={task.requirements?.maxPrice} />
      <ContactTable biddersWithInfo={biddersWithInfo} />
    </div>
  );
}
