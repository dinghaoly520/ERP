'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { FileSearch, FileText, FolderOpen, Loader2, Play, Shield } from 'lucide-react';
import { TenderReviewProvider } from '@/components/tender-review/tender-review-provider';
import { useTenderReview } from '@/components/tender-review/use-tender-review';
import TenderReviewWorkspace from '@/components/tender-review/tender-review-workspace';

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** hero 右侧统计徽标（需在 Provider 内取 context，故拆为子组件） */
function HeroStats() {
  const { stats, runningTasks } = useTenderReview();
  return (
    <div className="page-hero__right">
      {runningTasks.length > 0 && (
        <span className="page-hero__stat page-hero__stat--info">
          <Loader2 size={11} className="animate-spin" />
          进行中 {runningTasks.length}
        </span>
      )}
      <span className="page-hero__stat page-hero__stat--info">今日审查 {stats.totalReviews} · 违规 {stats.failedCount}</span>
    </div>
  );
}

/** hero 底部视图切换（审查执行 / 审查报告 + 动态文件/规则管理）——与采购文件编写同款 hero 内嵌切换，
 *  cgzxui .neu-segment 分段切换（本会话统一规格）；文件/规则管理为侧栏触发的上下文视图，激活时并入段。 */
function ReviewTabBar() {
  const { activeTab, setActiveTab } = useTenderReview();
  const tabs = [
    { id: 'review' as const, label: '审查执行', icon: Play },
    { id: 'reports' as const, label: '审查报告', icon: FileText },
    ...(activeTab === 'files' ? [{ id: 'files' as const, label: '文件管理', icon: FolderOpen }] : []),
    ...(activeTab === 'rules' ? [{ id: 'rules' as const, label: '规则管理', icon: Shield }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="审查视图">
      {tabs.map((t) => {
        const active = t.id === activeTab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setActiveTab(t.id)}
            className={[
              "inline-flex items-center gap-1.5 rounded-[8px] px-3.5 py-2 text-xs font-semibold transition-all duration-200",
              active
                ? "bg-[color-mix(in_oklch,var(--accent-soft)_55%,transparent)] text-[color:var(--accent)]"
                : "text-[color:var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_40%,transparent)]",
            ].join(" ")}
            style={active ? {
              boxShadow: "inset 1px 2px 3px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.4)",
            } : undefined}
          >
            <t.icon size={13} strokeWidth={1.9} aria-hidden="true" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function TenderReviewPage() {
  const reducedMotion = useReducedMotion() ?? false;

  const fadeIn = (index: number) => {
    if (reducedMotion) return { initial: {}, animate: {}, transition: { duration: 0 } };
    return {
      initial: { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.4, delay: index * 0.08, ease: easeOutQuint },
    };
  };

  return (
    <TenderReviewProvider>
      <motion.div {...fadeIn(0)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="page-hero mb-4 !rounded-[16px] shrink-0">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon">
                <FileSearch size={17} strokeWidth={1.9} />
              </div>
              <div>
                <div className="page-hero__title">采购文件审查</div>
                <div className="page-hero__sub">基于知识库规则引擎 + AI 语义分析，对采购文件进行合规性智能审查</div>
              </div>
            </div>
            <HeroStats />
          </div>

          <div className="mt-3 pt-2" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.12)" }}>
            <ReviewTabBar />
          </div>
        </div>
        <TenderReviewWorkspace />
      </motion.div>
    </TenderReviewProvider>
  );
}
