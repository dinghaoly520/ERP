'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * 全局错误兜底 Provider
 * 监听 window 'error' + 'unhandledrejection'，未捕获错误 → toast
 * 在 layout.tsx 客户端根处挂载一次。
 */
export function GlobalErrorHandler({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // eslint-disable-next-line no-console
      console.error('[global error]', e.error ?? e.message);
      toast.error('页面发生异常，请刷新重试');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.error('[unhandled rejection]', e.reason);
      // 已被 useAsyncState 处理的 rejection 不会到这里；只有漏网的才 toast
      toast.error('请求失败，请重试');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return <>{children}</>;
}
