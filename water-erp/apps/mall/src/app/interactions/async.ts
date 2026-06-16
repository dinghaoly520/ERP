'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface UseAsyncStateOptions<T> {
  /** 依赖数组：变化时自动重新获取 */
  deps?: unknown[];
  /** 初始数据 */
  initial?: T;
  /** 重新获取时保留旧数据（SWR 模式），status 保持 success，配合 isFetching 显示进度条 */
  keepPreviousData?: boolean;
  /** 判空谓词；默认 null/undefined/空数组视为空 */
  isEmpty?: (data: T) => boolean;
  /** 是否启用；false 时不获取 */
  enabled?: boolean;
}

export interface UseAsyncStateResult<T> {
  status: AsyncStatus;
  data: T | undefined;
  error: Error | undefined;
  retry: () => void;
  /** 请求是否在飞行中（含 keepPreviousData 重取） */
  isFetching: boolean;
}

/**
 * 异步状态管理 hook —— 模块 1 地基
 *
 * 管理一个异步数据源的 loading/empty/error/success 四态，
 * 配合 <StateBoundary> 渲染统一界面。
 */
export function useAsyncState<T>(
  fetcher: () => Promise<T>,
  options: UseAsyncStateOptions<T> = {},
): UseAsyncStateResult<T> {
  const {
    deps = [],
    initial,
    keepPreviousData = false,
    isEmpty,
    enabled = true,
  } = options;

  const [data, setData] = useState<T | undefined>(initial);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [isFetching, setIsFetching] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  const dataRef = useRef<T | undefined>(initial);
  const isEmptyRef = useRef(isEmpty);

  // 保持最新引用，避免 effect 频繁重建
  useEffect(() => {
    fetcherRef.current = fetcher;
    isEmptyRef.current = isEmpty;
  });

  // 同步 dataRef
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const hasPrevData = dataRef.current !== undefined;

    // keepPreviousData 模式：有旧数据时保持 success，否则进入 loading
    if (!keepPreviousData || !hasPrevData) {
      setStatus('loading');
      if (!keepPreviousData) {
        setError(undefined);
      }
    }
    setIsFetching(true);

    fetcherRef.current()
      .then((result) => {
        if (cancelled) return;
        setError(undefined);
        setData(result);
        dataRef.current = result;
        const checkEmpty = isEmptyRef.current;
        const empty =
          checkEmpty != null
            ? checkEmpty(result)
            : result == null || (Array.isArray(result) && result.length === 0);
        setStatus(empty ? 'empty' : 'success');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, retryTick, keepPreviousData]);

  const retry = useCallback(() => setRetryTick((t) => t + 1), []);

  return { status, data, error, retry, isFetching };
}
