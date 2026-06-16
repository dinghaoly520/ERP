'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { AsyncStatus } from './async';

// ─────────────────────────────────────────────
// <InlineError> — 行内错误展示 + 重试
// ─────────────────────────────────────────────

export function InlineError({
  message,
  detail,
  onRetry,
  retrying = false,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p className="mt-3 text-sm font-bold text-[#334155]">{message}</p>
      {detail && <p className="mt-1 text-xs text-[#8a96aa]">{detail}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#5b9bd5] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#4a89c4] active:scale-95 disabled:opacity-60"
        >
          {retrying && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {retrying ? '重试中…' : '重试'}
        </button>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// <StateBoundary> — 统一四态容器
// ─────────────────────────────────────────────

export interface StateBoundaryProps {
  status: AsyncStatus;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  error?: { message: string; detail?: string; onRetry?: () => void; retrying?: boolean };
  children?: React.ReactNode;
  /** 容器 aria-label，用于无障碍 */
  ariaLabel?: string;
  className?: string;
}

/**
 * 根据 status 渲染 loading/empty/error/success 四态。
 * 状态切换有 AnimatePresence 过渡，loading role=status，error role=alert。
 */
export function StateBoundary({
  status,
  loading,
  empty,
  error,
  children,
  ariaLabel,
  className = '',
}: StateBoundaryProps) {
  // 成功态直接渲染 children（不包 motion 避免重挂载）
  if (status === 'success') {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className} aria-label={ariaLabel} aria-busy={status === 'loading'}>
      <AnimatePresence mode="wait">
        {status === 'loading' && (
          <motion.div
            key="loading"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {loading ?? <DefaultLoading />}
          </motion.div>
        )}
        {status === 'empty' && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {empty}
          </motion.div>
        )}
        {status === 'error' && error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <InlineError
              message={error.message}
              detail={error.detail}
              onRetry={error.onRetry}
              retrying={error.retrying}
            />
          </motion.div>
        )}
        {(status === 'idle') && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        )}
      </AnimatePresence>
    </div>
  );
}

function DefaultLoading() {
  return (
    <div className="flex items-center justify-center py-12" role="status">
      <svg className="h-6 w-6 animate-spin text-[#5b9bd5]" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}
