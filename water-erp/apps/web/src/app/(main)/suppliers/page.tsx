"use client";

import { motion, useReducedMotion } from "framer-motion";

// ─── Animation ─────────────────────────────────────────────────────────────────
const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(index: number, reducedMotion: boolean) {
  if (reducedMotion) return { initial: {}, animate: {}, transition: { duration: 0 } };
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, delay: index * 0.08, ease: easeOutQuint },
  };
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function SuppliersPage() {
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <motion.div {...fadeIn(0, reducedMotion)} className="min-h-full">
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">供应商管理模块</h2>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)] max-w-md">
            此模块将用于供应商档案管理，包括供应商信息维护、中标记录追踪、资质审核、项目关联等功能。
          </p>
        </div>
      </div>
    </motion.div>
  );
}