'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { FileSearch, Loader2 } from 'lucide-react';
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

/** 视图切换（审查执行 / 审查报告 + 动态文件/规则管理）——2026-11-06 移出 hero 独立工具行，
 *  并对齐信息发布中心类型切换的 .neu-segment 分段切换设计（内凹轨道+滑动拇指，段内不带图标）；
 *  文件/规则管理为侧栏触发的上下文视图，激活时并入段（段数随之 2↔3，走内联 --segs 通式）。 */
function ReviewTabBar() {
  const { activeTab, setActiveTab } = useTenderReview();
  const tabs = [
    { id: 'review' as const, label: '审查执行' },
    { id: 'reports' as const, label: '审查报告' },
    ...(activeTab === 'files' ? [{ id: 'files' as const, label: '文件管理' }] : []),
    ...(activeTab === 'rules' ? [{ id: 'rules' as const, label: '规则管理' }] : []),
  ];
  return (
    <div
      className="neu-segment"
      role="group"
      aria-label="审查视图"
      data-count={String(tabs.length)}
      data-index={String(Math.max(0, tabs.findIndex((t) => t.id === activeTab)))}
      style={{ '--segs': tabs.length } as React.CSSProperties}
    >
      <span className="neu-segment-thumb" aria-hidden="true" />
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className="neu-segment-btn"
          aria-pressed={activeTab === t.id}
          onClick={() => setActiveTab(t.id)}
        >
          {t.label}
        </button>
      ))}
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
                <div className="page-hero__sub">上传采购文件，自动比对合规规则并生成审查意见</div>
              </div>
            </div>
            <HeroStats />
          </div>
          {/* hairline 下横线（cgzxui 规定：标题行与下方内容之间必有分割线） */}
          <div className="page-hero__divider" />
        </div>

        {/* 视图切换行——独立工具行（2026-11-06 用户裁定移出标题栏，与采购台账/通知中心同款设计）。
            flex 行容器：neu-segment 为块级 grid，须作 flex 子项按文字宽度收缩（块级包裹会拉满页宽） */}
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
          <ReviewTabBar />
        </div>
        <TenderReviewWorkspace />
      </motion.div>
    </TenderReviewProvider>
  );
}
