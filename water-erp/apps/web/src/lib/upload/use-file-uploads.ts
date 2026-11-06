'use client';

/**
 * 顺序上传队列 hook（2026-11-06 上传进度条 spec §5）：
 *  - 逐文件顺序上传（不并发，保持服务端逐个写附件/extractedInfo 的既有行为）；
 *  - 失败不中断队列：逐文件标记 failed 可单文件重试（retry 不触发 onAllSettled——
 *    AI 分析等「整批结束」语义只在 start() 的队列走完时触发一次）；
 *  - cancel：abort 当前文件 + 未开始的置 canceled；已完成的保留；
 *  - 速度：2s 滑动窗字节差，窗 <400ms 不出值（防起始抖动）。
 */
import { useCallback, useMemo, useRef, useState } from 'react';

export type UploadItemStatus = 'pending' | 'uploading' | 'done' | 'failed' | 'canceled';

export interface UploadItem<T = unknown> {
  id: string;
  file: File;
  status: UploadItemStatus;
  loaded: number;
  total: number;
  error?: string;
  result?: T;
}

export interface UploadAggregate {
  /** Σ已传字节/Σ总字节（非文件计数） */
  pct: number;
  loaded: number;
  total: number;
  speedBps: number | null;
  doneCount: number;
  failedCount: number;
}

/** 单文件上传：实现方调 api.upload 类通道，透传 onProgress/signal */
export type UploadOneFn<T> = (
  file: File,
  id: string,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
) => Promise<T>;

export function useFileUploads<T = unknown>(opts: {
  uploadOne: UploadOneFn<T>;
  /** 单文件成功（含 retry 成功）：注入附件/提取信息等页面副作用 */
  onEachDone?: (item: UploadItem<T> & { result: T }) => void;
  /** 整批队列走完（仅 start 触发；retry 不触发）：进入 AI 分析等收尾 */
  onAllSettled?: (summary: { done: number; failed: number; canceled: number }) => void;
}) {
  const [items, setItems] = useState<UploadItem<T>[]>([]);
  const [running, setRunning] = useState(false);
  const [speedBps, setSpeedBps] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef(false);
  const runTokenRef = useRef(0);
  const speedSamplesRef = useRef<Array<[number, number]>>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const patch = useCallback((id: string, p: Partial<UploadItem<T>>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const runOne = useCallback(
    async (item: UploadItem<T>, signal: AbortSignal, baseBytes: number): Promise<'done' | 'failed' | 'canceled'> => {
      patch(item.id, { status: 'uploading', loaded: 0, total: item.file.size, error: undefined });
      try {
        const result = await optsRef.current.uploadOne(item.file, item.id, (loaded, total) => {
          patch(item.id, { loaded, total });
          // 速度样本按「跨文件累计字节」记录，文件切换不断速
          const now = Date.now();
          const arr = speedSamplesRef.current;
          arr.push([now, baseBytes + loaded]);
          const cutoff = now - 2000;
          while (arr.length > 2 && arr[0][0] < cutoff) arr.shift();
          const [t0, l0] = arr[0];
          if (now - t0 >= 400) setSpeedBps((baseBytes + loaded - l0) / ((now - t0) / 1000));
        }, signal);
        patch(item.id, { status: 'done', loaded: item.file.size, total: item.file.size, result });
        optsRef.current.onEachDone?.({ ...item, status: 'done', loaded: item.file.size, total: item.file.size, result });
        return 'done';
      } catch (e) {
        if (signal.aborted) {
          patch(item.id, { status: 'canceled' });
          return 'canceled';
        }
        patch(item.id, { status: 'failed', error: e instanceof Error ? e.message : '上传失败' });
        return 'failed';
      }
    },
    [patch],
  );

  const runQueue = useCallback(
    async (queue: UploadItem<T>[], token: number, fireSettled: boolean) => {
      setRunning(true);
      cancelRef.current = false;
      speedSamplesRef.current = [];
      setSpeedBps(null);
      const summary = { done: 0, failed: 0, canceled: 0 };
      let baseBytes = 0;
      for (const it of queue) {
        if (token !== runTokenRef.current) return; // 新一轮 start/retry 接管
        if (cancelRef.current) {
          if (it.status !== 'done') patch(it.id, { status: 'canceled' });
          summary.canceled++;
          baseBytes += it.file.size;
          continue;
        }
        if (it.status === 'done') {
          summary.done++;
          baseBytes += it.file.size;
          continue;
        }
        abortRef.current = new AbortController();
        const outcome = await runOne(it, abortRef.current.signal, baseBytes);
        summary[outcome]++;
        baseBytes += it.file.size;
      }
      abortRef.current = null;
      setRunning(false);
      if (token === runTokenRef.current && fireSettled) optsRef.current.onAllSettled?.(summary);
    },
    [patch, runOne],
  );

  /** 开跑整批：替换 items 为新队列（旧队列若在跑，token 递增使其失效） */
  const start = useCallback(
    (files: File[]) => {
      const list: UploadItem<T>[] = files.map(file => ({
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        file,
        status: 'pending' as const,
        loaded: 0,
        total: file.size,
      }));
      setItems(list);
      const token = ++runTokenRef.current;
      void runQueue(list, token, true);
    },
    [runQueue],
  );

  /** 单文件重试：不触发 onAllSettled（spec §5.4——事后重试不重跑 AI 分析） */
  const retry = useCallback(
    (id: string) => {
      const item = items.find(x => x.id === id);
      if (!item || item.status === 'uploading' || item.status === 'pending') return;
      const reset: UploadItem<T> = { ...item, status: 'pending', loaded: 0, error: undefined };
      setItems(prev => prev.map(x => (x.id === id ? reset : x)));
      const token = ++runTokenRef.current;
      void runQueue([reset], token, false);
    },
    [items, runQueue],
  );

  /** 取消：abort 当前 + 未开始的置 canceled */
  const cancel = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
  }, []);

  /** 清空行列表（阶段切换/弹窗关闭时调用） */
  const clear = useCallback(() => {
    runTokenRef.current++; // 在跑队列失效
    cancelRef.current = true;
    abortRef.current?.abort();
    setItems([]);
    setRunning(false);
    setSpeedBps(null);
  }, []);

  const aggregate: UploadAggregate = useMemo(() => {
    const total = items.reduce((s, it) => s + (it.total || it.file.size || 0), 0);
    const loaded = items.reduce((s, it) => s + it.loaded, 0);
    return {
      pct: total > 0 ? Math.round((loaded / total) * 100) : 0,
      loaded,
      total,
      speedBps,
      doneCount: items.filter(i => i.status === 'done').length,
      failedCount: items.filter(i => i.status === 'failed').length,
    };
  }, [items, speedBps]);

  return { items, start, retry, cancel, clear, running, aggregate };
}
