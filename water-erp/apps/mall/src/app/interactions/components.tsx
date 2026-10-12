'use client';

import { motion } from 'framer-motion';
import { useCountUp } from './hooks';

/**
 * 统一空状态
 * icon 支持 ReactNode（推荐 Lucide 图标）或字符串（兼容旧 emoji 调用）
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
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
      {icon && (
        <motion.span
          className="flex h-16 w-16 items-center justify-center text-[#bcc6d4]"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          {icon}
        </motion.span>
      )}
      <h3 className="mt-4 text-base font-black text-[#334155]">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[#8a96aa]">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 rounded-xl bg-[#5b9bd5] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#4a89c4] active:scale-95"
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
