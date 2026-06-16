'use client';

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { motion } from 'framer-motion';

// ─────────────────────────────────────────────
// ErrorBoundary — 兜住渲染崩溃，不白屏
// ─────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** key 变化时重置（如路由切换） */
  resetKey?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <PageErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

/** 默认兜底页 */
export function PageErrorFallback({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center"
    >
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <h2 className="mt-4 text-xl font-black text-[#334155]">页面出错了</h2>
      <p className="mt-2 max-w-md text-sm text-[#8a96aa]">
        抱歉，页面遇到了问题。您可以尝试刷新页面，若问题持续请联系管理员。
      </p>
      {process.env.NODE_ENV === 'development' && error && (
        <pre className="mt-4 max-w-lg overflow-auto rounded-lg bg-[#f7faff] p-3 text-left text-xs text-[#5a6d8a]">
          {error.message}
        </pre>
      )}
      <button
        onClick={onRetry ?? (() => window.location.reload())}
        className="mt-5 rounded-xl bg-[#5b9bd5] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#4a89c4] active:scale-95"
      >
        重新加载
      </button>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// withRetry — 网络错误自动重试（指数退避 + 抖动）
// ─────────────────────────────────────────────

export function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes('fetch')) return true; // 网络断开
  if (err instanceof DOMException && err.name === 'AbortError') return false; // 用户取消
  // 自定义 status 属性（由 api 包装器抛出）
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === 'number') {
    if (status >= 500) return true; // 服务端错误
    if (status >= 400) return false; // 客户端错误
  }
  return true; // 默认可重试（超时等）
}

export function withRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts: { retries?: number; backoff?: number[]; retryOn?: (err: unknown) => boolean } = {},
): (...args: TArgs) => Promise<TResult> {
  const { retries = 3, backoff = [1000, 2000, 4000], retryOn = isRetryableError } = opts;

  return async (...args: TArgs) => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await fn(...args);
      } catch (err) {
        attempt += 1;
        if (attempt > retries || !retryOn(err)) throw err;
        const base = backoff[Math.min(attempt - 1, backoff.length - 1)];
        const jitter = base * (0.8 + Math.random() * 0.4);
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  };
}
