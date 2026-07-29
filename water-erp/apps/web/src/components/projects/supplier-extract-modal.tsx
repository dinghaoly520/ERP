'use client';

import { Suspense, useEffect } from 'react';
import { Building2, X } from 'lucide-react';
import { SupplierSelectionPage } from '@/app/(main)/supplier/selection/page';
import { RulesPopover } from '@/components/rules-popover';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
};

export function SupplierExtractModal({ isOpen, onClose, project }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background:
              'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--success-soft, color-mix(in oklch, var(--success) 16%, transparent)) 45%, transparent)',
                boxShadow:
                  'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <Building2 size={17} className="text-[var(--success)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                供应商邀请
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                按采购需求 AI 语义匹配候选供应商，构建邀请名单并多渠道通知
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RulesPopover label="匹配规则" accentColor="var(--success)">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">供应商选取规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">1.</span><strong>业务标签精准匹配</strong>：AI 语义分析项目采购内容、工程类别与专业领域，从企业标签词表中严格筛选 3-6 个核心标签（如钻探设备、地质勘查、岩心钻探），作为候选池初筛维度。已有标签时不再自动覆盖。</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">2.</span><strong>候选池合规过滤</strong>：按供应商分类、企业类型、经营范围与标签的匹配关系进行粗筛，排除不相关或不符合基本资质的企业。</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">3.</span><strong>多维能力评分</strong>：AI 综合供应商资质匹配度、经营范围与项目契合度、历史履约评价等级（A/B/C/D）、出勤/质量/廉洁三维度、评分偏离度与当前负荷，计算 0-100 匹配分。</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">4.</span><strong>综合排序推荐</strong>：按匹配度降序输出，≥85 强匹配 / ≥70 较匹配 / ≥55 可考虑 / ＜55 弱匹配。AI 服务不可用时自动降级为规则关键词匹配。</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">5.</span><strong>手动选取模式</strong>：按供应商名称、标签或经营范围直接搜索，无需业务标签匹配，逐家加入候选名单。适用于已明确目标供应商的场景。</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">6.</span><strong>逐家通知与回执</strong>：候选确认后支持站内信/短信多渠道逐家发送通知（含专属短链接回执），供应商点击链接即可确认参加或无法参加，采购端实时查看回执看板。</li>
              </ol>
            </RulesPopover>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-5"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow:
              'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          <Suspense fallback={
            <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">
              加载供应商邀请配置...
            </div>
          }>
            <SupplierSelectionPage
              hideHeader
              defaultProjectTitle={project?.title}
              project={project}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
