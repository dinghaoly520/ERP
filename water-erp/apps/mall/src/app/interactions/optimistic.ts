'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// ─────────────────────────────────────────────
// useOptimisticToggle — 幂等开关（收藏场景）
// 点击即响应，失败自动回滚
// ─────────────────────────────────────────────

export interface OptimisticToggleOptions<TId> {
  /** 判断当前是否已激活 */
  hasItem: (id: TId) => boolean;
  /** 乐观添加 */
  onAdd: (id: TId) => void;
  /** 乐观移除 */
  onRemove: (id: TId) => void;
  /** 后端持久化；favorited=true 表示目标态（添加后） */
  mutate: (id: TId, favorited: boolean) => Promise<void>;
  /** 失败回调（默认 toast） */
  onError?: (id: TId, favorited: boolean) => void;
}

export function useOptimisticToggle<TId>(opts: OptimisticToggleOptions<TId>) {
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  return useCallback((id: TId) => {
    const o = optsRef.current;
    const wasActive = o.hasItem(id);
    const targetActive = !wasActive;

    // 乐观应用
    if (targetActive) o.onAdd(id);
    else o.onRemove(id);

    // 后台持久化，失败回滚
    o.mutate(id, targetActive).catch(() => {
      // 回滚到原态
      if (targetActive) o.onRemove(id);
      else o.onAdd(id);
      if (o.onError) {
        o.onError(id, targetActive);
      } else {
        toast.error('操作失败，已恢复');
      }
    });
  }, []);
}

// ─────────────────────────────────────────────
// useUndoableAction — 可撤销操作（删除场景）
// 乐观应用 → 撤销窗口 toast → 撤销或超时
// ─────────────────────────────────────────────

export interface UndoableActionOptions<TItem> {
  /** 撤销窗口时长，默认 5000ms */
  windowMs?: number;
  /** toast 文案 */
  label: (item: TItem) => string;
}

export interface UndoableExecuteParams<TItem> {
  /** 被移除的项（用于恢复 + toast） */
  item: TItem;
  /** 乐观应用（立即移除） */
  apply: () => void;
  /** 撤销时恢复 */
  restore: () => void;
}

export function useUndoableAction<TItem>(opts: UndoableActionOptions<TItem>) {
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const execute = useCallback((params: UndoableExecuteParams<TItem>) => {
    const { item, apply, restore } = params;
    const o = optsRef.current;
    const windowMs = o.windowMs ?? 5000;

    // 立即乐观应用
    apply();

    let undone = false;
    const undo = () => {
      if (undone) return;
      undone = true;
      restore();
    };

    toast(o.label(item), {
      duration: windowMs,
      action: {
        label: '撤销',
        onClick: undo,
      },
    });
  }, []);

  return { execute };
}

// ─────────────────────────────────────────────
// useAutoSave — 防抖持久化 + 状态外露
// ─────────────────────────────────────────────

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveOptions<T> {
  data: T;
  onSave: (data: T) => Promise<void>;
  /** 防抖时长，默认 700ms */
  debounceMs?: number;
  /** 载入触发的变更跳过（传 ref） */
  skipRef?: React.MutableRefObject<boolean>;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 失败自动重试次数，默认 3 */
  maxRetries?: number;
}

export function useAutoSave<T>(opts: AutoSaveOptions<T>): {
  status: AutoSaveStatus;
  retry: () => void;
} {
  const { data, onSave, debounceMs = 700, skipRef, enabled = true, maxRetries = 3 } = opts;
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [retryTick, setRetryTick] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedDataRef = useRef(data); // 上次成功保存的数据
  const onSaveRef = useRef(onSave);
  const savingRef = useRef(false);

  useEffect(() => { onSaveRef.current = onSave; });

  useEffect(() => {
    if (!enabled) return;
    if (skipRef?.current) {
      skipRef.current = false;
      savedDataRef.current = data; // 载入的数据视为已保存
      return;
    }

    // 数据未变化则不保存
    if (data === savedDataRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void doSave();
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, enabled, debounceMs, retryTick]);

  const doSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');

    let attempt = 0;
    const tryOnce = async () => {
      try {
        await onSaveRef.current(savedDataRef.current === data ? data : data);
        savedDataRef.current = data;
        setStatus('saved');
        // saved 显示 2s 后回 idle
        setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
      } catch (err) {
        attempt += 1;
        if (attempt < maxRetries) {
          // 指数退避
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
          return tryOnce();
        }
        setStatus('error');
        toast.error('自动保存失败，点击重试');
      }
    };

    await tryOnce();
    savingRef.current = false;
  }, [data, maxRetries]);

  const retry = useCallback(() => {
    setStatus('idle');
    setRetryTick((t) => t + 1);
  }, []);

  return { status, retry };
}
