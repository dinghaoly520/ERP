'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Search } from 'lucide-react';
import { TenderReviewProvider } from '@/components/tender-review/tender-review-provider';
import TenderReviewWorkspace from '@/components/tender-review/tender-review-workspace';

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

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
        <div className="page-hero mb-4 !rounded-[16px]">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon">
                <Search size={17} />
              </div>
              <div>
                <div className="page-hero__title">采购文件审查</div>
                <div className="page-hero__sub">基于知识库规则引擎 + AI 语义分析，对采购文件进行合规性智能审查</div>
              </div>
            </div>
          </div>
        </div>
        <TenderReviewWorkspace />
      </motion.div>
    </TenderReviewProvider>
  );
}
