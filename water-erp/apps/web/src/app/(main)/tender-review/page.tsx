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
        </div>
        <TenderReviewWorkspace />
      </motion.div>
    </TenderReviewProvider>
  );
}
