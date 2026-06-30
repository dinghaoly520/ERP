'use client';

import { motion, useReducedMotion } from 'framer-motion';
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
      <motion.div {...fadeIn(0)} className="min-h-full">
        <TenderReviewWorkspace />
      </motion.div>
    </TenderReviewProvider>
  );
}
