'use client';

import { useEffect } from 'react';

/**
 * Service Worker 注册器（Phase ⑤ Task 6）
 *
 * 仅在生产环境注册 —— 开发环境 hot reload 与 SW 缓存冲突，体验很差。
 * 注册失败静默忽略（SW 是渐进增强，不影响主功能）。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* 静默 —— 渐进增强 */
      });
    };
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
