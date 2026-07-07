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

const CONCORDANCE_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  conflict: {
    label: '冲突',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-200',
  },
  minor_diff: {
    label: '轻微差异',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
  },
  consistent: {
    label: '一致',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
};

function ConcordanceList({ items }: { items: ConcordanceItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 6);

  return (
    <>
      {shown.map((check, i) => {
        const cfg = CONCORDANCE_STATUS_CONFIG[check.status ?? ''] ?? CONCORDANCE_STATUS_CONFIG.consistent;
        return (
          <div key={i} className={`${cfg.bg} ${cfg.border} border rounded-lg p-2.5`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
              <span className="font-semibold text-xs text-[var(--color-text)]">
                {check.label || check.field}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-auto font-medium ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] ml-3.5">
              <div>
                <span className="text-[var(--color-text-tertiary)]">系统：</span>
                <span className="text-[var(--color-text)] font-medium">
                  {check.systemValue != null ? String(check.systemValue) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-tertiary)]">OCR：</span>
                <span className="text-[var(--color-text)] font-medium">
                  {check.docValue != null ? String(check.docValue) : '—'}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      {items.length > 6 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 text-[11px] text-[var(--color-primary)] hover:underline"
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
  if (!keyInfo) {
    return (
      <div className="text-center py-6">
        <Clipboard size={24} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无关键信息</p>
      </div>
    );
  }

  const info = keyInfo as Record<string, any>;
  const contact = (info.contactInfo ?? {}) as Record<string, any>;
  const keyPerformances = Array.isArray(info.keyPerformances) ? info.keyPerformances : [];

  return (
    <div className="space-y-3">
      {/* 公司信息 + 投标信息 双列 */}
      <div className="grid grid-cols-2 gap-3">
        {/* 公司信息 */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">公司信息</h4>
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
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">投标信息</h4>
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
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">联系方式</h4>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <FieldCard icon={<Phone size={12} />} label="电话" value={contact.phone} />
            <FieldCard icon={<Mail size={12} />} label="邮箱" value={contact.email} />
            <FieldCard icon={<MapPin size={12} />} label="地址" value={contact.address} />
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">项目团队</h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FieldCard icon={<Briefcase size={12} />} label="项目经理" value={info.proposedProjectManager ?? info.projectManager} />
            <FieldCard icon={<Award size={12} />} label="职称" value={info.proposedProjectManagerTitle ?? info.projectManagerTitle} />
            <FieldCard icon={<ShieldCheck size={12} />} label="执业资格" value={info.proposedProjectManagerQualification} />
            <FieldCard icon={<span className="text-xs">👥</span>} label="团队人数" value={info.teamSize} />
          </div>
        </div>
      </div>

      {/* 关键业绩 */}
      {keyPerformances.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h4 className="font-bold text-sm text-[var(--color-text)]">
              关键业绩（{info.performanceCount ?? keyPerformances.length} 项）
            </h4>
          </div>
          <div className="space-y-2">
            {keyPerformances.slice(0, 5).map((kp: any, i: number) => (
              <div key={i} className="glass-card glass-card-lighter rounded-lg p-3 flex items-center gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--color-text)] truncate">{kp.projectName}</div>
                  {kp.keyMetrics && (
                    <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{kp.keyMetrics}</div>
                  )}
                </div>
                {kp.contractAmount && (
                  <span className="text-xs font-medium text-[var(--color-text-secondary)] shrink-0">
                    {kp.contractAmount}
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

// ── 数据一致性（证据子块）──

function ConcordanceSection({ concordance, concordanceStatus }: { concordance: any; concordanceStatus?: string }) {
  if (!concordance || !Array.isArray(concordance as any[])) {
    return (
      <div className="text-center py-4">
        <AlertCircle size={20} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-1.5" />
        <p className="text-xs text-[var(--color-text-tertiary)]">暂无一致性数据</p>
      </div>
    );
  }

  const checks = concordance as unknown as ConcordanceItem[];
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
      <div className="flex items-center gap-3 mb-2 text-xs">
        <span className="font-semibold text-red-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
          {conflicts.length} 冲突
        </span>
        <span className="font-semibold text-amber-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1" />
          {warnings.length} 差异
        </span>
        <span className="font-semibold text-emerald-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
          {consistent.length} 一致
        </span>
        {concordanceStatus && (
          <span className="text-[var(--color-text-tertiary)] ml-auto">
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
          <div className="flex items-center gap-2 mb-2 text-xs font-bold text-[oklch(0.45_0.01_264)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#064ea2]" /> 数据一致性（系统 vs OCR）
          </div>
          <ConcordanceSection concordance={assistData.concordance} concordanceStatus={assistData.concordanceStatus} />
        </div>
      </div>
    </section>
  );
}
