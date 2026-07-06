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
export default function SmartBidPage() {
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <motion.div {...fadeIn(0, reducedMotion)} className="flex flex-1 flex-col items-center justify-center min-h-[60vh]">
      <div className="text-center">
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">智能标书编写模块</h2>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)] max-w-md">
            此模块将用于投标文件的AI全自动生成，包括招标文件分析、资质匹配、方案编写、格式校验等功能。
          </p>
      </div>
    </motion.div>
  );
}