'use client';

import { motion } from 'framer-motion';
import { useCountUp } from './hooks';

/**
 * 骨架屏 - 匹配表格行布局
 */
export function Skeleton({
  rows = 4,
  cols = 6,
  className = '',
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={`w-full ${className}`} role="status" aria-label="加载中">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-3 border-b border-[#eef3f8] px-4 py-4 last:border-0"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 animate-skeleton rounded bg-[#e8edf5]"
              style={{ flex: c === 0 ? 2 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 统一空状态
 */
export function EmptyState({
  icon = '📋',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <motion.span
        className="text-5xl"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {icon}
      </motion.span>
      <h3 className="mt-4 text-lg font-black text-[#18243a]">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[#8a96aa]">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#043d82] active:scale-95"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

/**
 * 数字弹跳徽标 - 用于预算清单 badge 等
 */
export function AnimatedBadge({
  value,
  className = '',
}: {
  value: number;
  className?: string;
}) {
  const display = useCountUp(value, { duration: 0.6, spring: true });
  const changed = value > 0; // will trigger spring on first mount too

  return (
    <motion.span
      key={value}
      initial={value > 0 ? { scale: 1.4 } : false}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 15 }}
      className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e74c3c] px-1 text-xs text-white ${className}`}
    >
      <motion.span>{display}</motion.span>
    </motion.span>
  );
}

/**
 * 页面级入场过渡包装器
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * 顺序入场容器
 */
export function StaggerContainer({
  children,
  className = '',
  perItemDelay = 0.05,
}: {
  children: React.ReactNode;
  className?: string;
  perItemDelay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: perItemDelay } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * 顺序入场子项
 */
export function StaggerItem({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 28 } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * 迷你进度条
 */
export function MiniProgressBar({ className = '' }: { className?: string }) {
  return (
    <div className={`h-0.5 w-full overflow-hidden rounded-full bg-[#e1e9f4] ${className}`}>
      <motion.div
        className="h-full rounded-full bg-[#064ea2]"
        initial={{ width: '0%' }}
        animate={{ width: '100%' }}
        transition={{ duration: 3, ease: 'easeInOut' }}
      />
    </div>
  );
}
