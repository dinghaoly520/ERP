'use client';

import { useState } from 'react';
import {
  Building2,
  Clock,
  ShieldCheck,
  Award,
  ClipboardCheck,
  Briefcase,
  Banknote,
  Phone,
  Mail,
  MapPin,
  Clipboard,
  AlertCircle,
  CheckCircle,
  XCircle,
  Minus,
  Users,
} from 'lucide-react';
import type { AssistData } from '@water-erp/shared';
import { FieldCard } from './shared/field-card';
import { SectionHeader } from './shared/section-header';

interface ConcordanceItem {
  label?: string;
  field?: string;
  systemValue?: unknown;
  docValue?: unknown;
  status?: string;
  severity?: string;
  note?: string;
}

interface KeyInfoData {
  quotePriceYuan?: string | number;
  legalPerson?: string;
  registeredCapital?: string;
  establishedDate?: string;
  qualificationLevel?: string;
  qualificationName?: string;
  qualificationStatus?: string;
  constructionPeriod?: string;
  warrantyPeriod?: string;
  priceValidity?: number;
  proposedProjectManager?: string;
  projectManager?: string;
  proposedProjectManagerTitle?: string;
  projectManagerTitle?: string;
  proposedProjectManagerQualification?: string;
  teamSize?: number;
  performanceCount?: number;
  contactInfo?: { phone?: string; email?: string; address?: string };
  keyPerformances?: Array<{ projectName?: string; keyMetrics?: string; contractAmount?: string }>;
}

interface KeyPerformanceItem {
  projectName?: string;
  keyMetrics?: string;
  contractAmount?: string;
}

interface ContactInfoData {
  phone?: string;
  email?: string;
  address?: string;
}

// 一致性状态 → .exp-alert 语义变体 + pill 点色
const CONCORDANCE_STATUS_CONFIG: Record<string, { label: string; alert: string; c: string }> = {
  conflict: { label: '冲突', alert: 'exp-alert', c: 'var(--danger)' },
  minor_diff: { label: '轻微差异', alert: 'exp-alert exp-alert--warn', c: 'var(--warning)' },
  consistent: { label: '一致', alert: 'exp-alert exp-alert--success', c: 'var(--success)' },
};

function ConcordanceList({ items }: { items: ConcordanceItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 6);

  return (
    <>
      {shown.map((check, i) => {
        const cfg = CONCORDANCE_STATUS_CONFIG[check.status ?? ''] ?? CONCORDANCE_STATUS_CONFIG.consistent;
        return (
          <div key={i} className={`${cfg.alert} !p-2.5 !font-normal`}>
            <div className="mb-1 flex items-center gap-2">
              <span className="exp-pill-dot shrink-0" style={{ '--c': cfg.c } as React.CSSProperties} />
              <span className="text-xs font-semibold text-[var(--foreground)]">
                {check.label || check.field}
              </span>
              <span className="exp-pill ml-auto" style={{ '--c': cfg.c } as React.CSSProperties}>
                {cfg.label}
              </span>
            </div>
            <div className="ml-3.5 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-[var(--muted-foreground)]">系统：</span>
                <span className="font-medium text-[var(--foreground)]">
                  {check.systemValue != null ? String(check.systemValue) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[var(--muted-foreground)]">OCR：</span>
                <span className="font-medium text-[var(--foreground)]">
                  {check.docValue != null ? String(check.docValue) : '—'}
                </span>
              </div>
            </div>
            {check.note && <div className="ml-3.5 mt-0.5 text-[10px] text-[var(--muted-foreground)]">{check.note}</div>}
          </div>
        );
      })}
      {items.length > 6 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 text-[11px] text-[var(--accent-strong)] hover:underline"
        >
          {showAll ? '收起' : `展开全部 ${items.length} 项`}
        </button>
      )}
    </>
  );
}

// ── ② 关键信息 ──

function KeyInfoSection({
  keyInfo,
  supplierName,
}: {
  keyInfo: AssistData['keyInfo'];
  supplierName: string;
}) {
  const [showAllPerf, setShowAllPerf] = useState(false);
  if (!keyInfo) {
    return (
      <div className="py-6 text-center">
        <Clipboard size={24} strokeWidth={1} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm text-[var(--muted-foreground)]">暂无关键信息</p>
      </div>
    );
  }

  const info = keyInfo as KeyInfoData;
  const contact = (info.contactInfo ?? {}) as ContactInfoData;
  const keyPerformances = Array.isArray(info.keyPerformances) ? info.keyPerformances : [];
  const PERF_PREVIEW = 5;
  const shownPerf = showAllPerf ? keyPerformances : keyPerformances.slice(0, PERF_PREVIEW);

  return (
    <div className="space-y-3">
      {/* 公司信息 + 投标信息 双列 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 公司信息 */}
        <div className="neu-card-static p-4">
          <div className="mb-3 flex items-center gap-2">
            <Building2 size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            <h4 className="text-sm font-bold text-[var(--foreground)]">公司信息</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Building2 size={12} />} label="法定代表人" value={info.legalPerson} />
            <FieldCard icon={<Clock size={12} />} label="注册资本" value={info.registeredCapital} />
            <FieldCard icon={<Clock size={12} />} label="成立日期" value={info.establishedDate} />
            <FieldCard icon={<ShieldCheck size={12} />} label="资质等级" value={info.qualificationLevel} />
            <FieldCard icon={<Award size={12} />} label="资质名称" value={info.qualificationName} />
            <FieldCard icon={<ClipboardCheck size={12} />} label="资格状态" value={info.qualificationStatus} />
          </div>
        </div>

        {/* 投标信息 */}
        <div className="neu-card-static p-4">
          <div className="mb-3 flex items-center gap-2">
            <Briefcase size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            <h4 className="text-sm font-bold text-[var(--foreground)]">投标信息</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Banknote size={12} strokeWidth={1.5} />} label="投标报价" value={info.quotePriceYuan} />
            <FieldCard icon={<Clock size={12} />} label="工期" value={info.constructionPeriod} />
            <FieldCard icon={<Clock size={12} />} label="质保期" value={info.warrantyPeriod} />
            <FieldCard icon={<Clock size={12} />} label="报价有效期" value={info.priceValidity ? `${info.priceValidity}天` : undefined} />
          </div>
        </div>
      </div>

      {/* 联系方式 + 项目团队 双列 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="neu-card-static p-4">
          <div className="mb-3 flex items-center gap-2">
            <Phone size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            <h4 className="text-sm font-bold text-[var(--foreground)]">联系方式</h4>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <FieldCard icon={<Phone size={12} />} label="电话" value={contact.phone} />
            <FieldCard icon={<Mail size={12} />} label="邮箱" value={contact.email} />
            <FieldCard icon={<MapPin size={12} />} label="地址" value={contact.address} />
          </div>
        </div>
        <div className="neu-card-static p-4">
          <div className="mb-3 flex items-center gap-2">
            <Briefcase size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            <h4 className="text-sm font-bold text-[var(--foreground)]">项目团队</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Briefcase size={12} />} label="项目经理" value={info.proposedProjectManager ?? info.projectManager} />
            <FieldCard icon={<Award size={12} />} label="职称" value={info.proposedProjectManagerTitle ?? info.projectManagerTitle} />
            <FieldCard icon={<ShieldCheck size={12} />} label="执业资格" value={info.proposedProjectManagerQualification} />
            <FieldCard icon={<Users size={12} />} label="团队人数" value={info.teamSize} />
          </div>
        </div>
      </div>

      {/* 关键业绩 */}
      {keyPerformances.length > 0 && (
        <div className="neu-card-static p-4">
          <div className="mb-3 flex items-center gap-2">
            <Award size={14} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
            <h4 className="text-sm font-bold text-[var(--foreground)]">
              关键业绩（{info.performanceCount ?? keyPerformances.length} 项）
            </h4>
          </div>
          <div className="space-y-2">
            {shownPerf.map((kp: KeyPerformanceItem, i: number) => (
              <div key={i} className="neu-attachment-item text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklch,var(--accent-strong)_12%,transparent)] text-xs font-bold text-[var(--accent-strong)]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[var(--foreground)]">{kp.projectName}</div>
                  {kp.keyMetrics && (
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{kp.keyMetrics}</div>
                  )}
                </div>
                {kp.contractAmount && (
                  <span className="shrink-0 text-xs font-medium text-[var(--muted-foreground)]">
                    {kp.contractAmount}
                  </span>
                )}
              </div>
            ))}
            {keyPerformances.length > PERF_PREVIEW && (
              <button onClick={() => setShowAllPerf(v => !v)} className="text-[11px] text-[var(--accent-strong)] hover:underline">
                {showAllPerf ? '收起' : `展开全部 ${keyPerformances.length} 项`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 数据一致性（证据子块）──

function ConcordanceSection({ concordance, concordanceStatus }: { concordance: ConcordanceItem[] | null | undefined; concordanceStatus?: string }) {
  if (!concordance || !Array.isArray(concordance)) {
    return (
      <div className="py-4 text-center">
        <AlertCircle size={20} strokeWidth={1} className="mx-auto mb-1.5 opacity-50" />
        <p className="text-xs text-[var(--muted-foreground)]">暂无一致性数据</p>
      </div>
    );
  }

  const checks = concordance;
  const conflicts = checks.filter((c) => c.status === 'conflict');
  const warnings = checks.filter((c) => c.status === 'minor_diff');
  const consistent = checks.filter((c) => c.status === 'consistent');
  const sorted = [...checks]
    .filter((c) => c.status !== 'insufficient_data')
    .sort((a, b) => {
      const order = { conflict: 0, minor_diff: 1, consistent: 2 };
      return (order[a.status as keyof typeof order] ?? 3) - (order[b.status as keyof typeof order] ?? 3);
    });

  return (
    <div>
      {/* 统计条 */}
      <div className="mb-2 flex items-center gap-3 text-xs">
        <span className="font-semibold text-[var(--danger)]">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />
          {conflicts.length} 冲突
        </span>
        <span className="font-semibold text-[oklch(0.52_0.13_70)]">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
          {warnings.length} 差异
        </span>
        <span className="font-semibold text-[var(--success)]">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
          {consistent.length} 一致
        </span>
        {concordanceStatus && (
          <span className="ml-auto text-[var(--muted-foreground)]">
            {concordanceStatus === 'consistent' ? <span className="inline-flex items-center gap-1"><CheckCircle size={12} strokeWidth={1.5} />一致</span> : concordanceStatus === 'conflict' ? <span className="inline-flex items-center gap-1"><XCircle size={12} strokeWidth={1.5} />冲突</span> : <span className="inline-flex items-center gap-1"><Minus size={12} strokeWidth={1.5} />差异</span>}
          </span>
        )}
      </div>

      {/* 字段明细（非一致项，可展开） */}
      <div className="space-y-1.5">
        <ConcordanceList items={sorted.filter(c => c.status !== 'consistent')} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ② 证据层（关键信息 + 数据一致性子块）
// ═══════════════════════════════════════════════════════════════

export function EvidenceLayer({ assistData, supplierName }: { assistData: AssistData; supplierName: string }) {
  return (
    <section>
      <SectionHeader number={2} title="证据" subtitle="· OCR 提取的结构化数据" />
      <div className="mt-3 space-y-3">
        <KeyInfoSection keyInfo={assistData.keyInfo} supplierName={supplierName} />
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-[var(--muted-foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-strong)]" /> 数据一致性（系统 vs OCR）
          </div>
          <ConcordanceSection concordance={assistData.concordance} concordanceStatus={assistData.concordanceStatus} />
        </div>
      </div>
    </section>
  );
}
