'use client';

import { Clipboard, Building2, Phone, Mail, MapPin, Briefcase, Award, Clock, Shield } from 'lucide-react';
import type { AssistData } from '@water-erp/shared';

interface KeyInfoTabProps {
  keyInfo: AssistData['keyInfo'];
  supplierName: string;
}

interface FieldCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
}

function FieldCard({ icon, label, value, suffix }: FieldCardProps) {
  return (
    <div className="glass-card glass-card-lighter rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--color-text-tertiary)]">{icon}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{label}</span>
      </div>
      <div className="font-semibold text-sm text-[var(--color-text)]">
        {value != null ? String(value) + (suffix ?? '') : '—'}
      </div>
    </div>
  );
}

export function KeyInfoTab({ keyInfo, supplierName }: KeyInfoTabProps) {
  if (!keyInfo) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <Clipboard size={32} strokeWidth={1} className="text-[oklch(0.75_0.008_264)] mx-auto mb-3" />
        <p className="text-sm text-[var(--color-text-secondary)]">暂无关键信息</p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          投标文件 OCR 及 LLM 提取完成后，将在此展示{ supplierName }的关键结构化信息
        </p>
      </div>
    );
  }

  const info = keyInfo as Record<string, any>;
  const contact = (info.contactInfo ?? {}) as Record<string, any>;

  // 关键业绩提取
  const keyPerformances = Array.isArray(info.keyPerformances) ? info.keyPerformances : [];

  return (
    <div className="space-y-4">
      {/* 公司信息 */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
          <h3 className="font-bold text-sm text-[var(--color-text)]">公司信息</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FieldCard icon={<Building2 size={12} />} label="法定代表人" value={info.legalPerson} />
          <FieldCard icon={<span className="text-xs">💰</span>} label="注册资本" value={info.registeredCapital} />
          <FieldCard icon={<Clock size={12} />} label="成立日期" value={info.establishedDate} />
          <FieldCard icon={<Shield size={12} />} label="资质等级" value={info.qualificationLevel} />
          <FieldCard icon={<Award size={12} />} label="资质名称" value={info.qualificationName} />
          <FieldCard icon={<span className="text-xs">📋</span>} label="资格状态" value={info.qualificationStatus} />
        </div>
      </div>

      {/* 投标信息 */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
          <h3 className="font-bold text-sm text-[var(--color-text)]">投标信息</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FieldCard
            icon={<span className="text-xs">💵</span>}
            label="投标报价"
            value={info.quotePriceYuan}
            suffix="元"
          />
          <FieldCard icon={<Clock size={12} />} label="工期" value={info.constructionPeriod} />
          <FieldCard icon={<Clock size={12} />} label="质保期" value={info.warrantyPeriod} />
          <FieldCard icon={<Clock size={12} />} label="报价有效期" value={info.priceValidity ? `${info.priceValidity}天` : undefined} />
        </div>
      </div>

      {/* 联系方式 */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Phone size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
          <h3 className="font-bold text-sm text-[var(--color-text)]">联系方式</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FieldCard icon={<Phone size={12} />} label="联系电话" value={contact.phone} />
          <FieldCard icon={<Mail size={12} />} label="电子邮箱" value={contact.email} />
          <FieldCard icon={<MapPin size={12} />} label="公司地址" value={contact.address} />
        </div>
      </div>

      {/* 项目经理 & 团队 */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
          <h3 className="font-bold text-sm text-[var(--color-text)]">项目团队</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FieldCard icon={<Briefcase size={12} />} label="拟任项目经理" value={info.proposedProjectManager ?? info.projectManager} />
          <FieldCard icon={<Award size={12} />} label="项目经理职称" value={info.proposedProjectManagerTitle ?? info.projectManagerTitle} />
          <FieldCard icon={<Shield size={12} />} label="执业资格" value={info.proposedProjectManagerQualification} />
          <FieldCard icon={<span className="text-xs">👥</span>} label="团队人数" value={info.teamSize} />
        </div>
      </div>

      {/* 关键业绩 */}
      {keyPerformances.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
            <h3 className="font-bold text-sm text-[var(--color-text)]">
              关键业绩（{info.performanceCount ?? keyPerformances.length} 项）
            </h3>
          </div>
          <div className="space-y-2">
            {keyPerformances.slice(0, 5).map((kp: any, i: number) => (
              <div
                key={i}
                className="glass-card glass-card-lighter rounded-lg p-3 flex items-center gap-3 text-sm"
              >
                <span className="w-6 h-6 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[var(--color-text)] truncate">
                    {kp.projectName}
                  </div>
                  {kp.keyMetrics && (
                    <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                      {kp.keyMetrics}
                    </div>
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
