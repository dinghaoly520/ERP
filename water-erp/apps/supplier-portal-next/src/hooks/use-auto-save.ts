"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 表单本地自动保存（localStorage 草稿）— 移植自 Vue useAutoSave composable。
 * key：草稿键（通常含 projectId）；data：被监听的表单对象（每次渲染传入最新引用）。
 * 深比较走 JSON.stringify，无变化不落盘；debounce 后写入 { v:1, ts, data }。
 */
const PREFIX = "supplier_draft:";

interface Blob<T> {
  v: 1;
  ts: number;
  data: T;
}

function readBlob<T>(key: string): Blob<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.ts === "number" && parsed.data) return parsed as Blob<T>;
    return null;
  } catch {
    return null;
  }
}

export interface UseAutoSaveReturn {
  lastSavedAt: number | null;
  storedAt: number | null;
  hasDraft: boolean;
  dirty: boolean;
  restoreDraft: () => unknown | null;
  clearDraft: () => void;
  markClean: () => void;
}

export function useAutoSave<T extends object>(
  key: string,
  data: T,
  options: { debounce?: number; enabled?: boolean } = {},
): UseAutoSaveReturn {
  const debounce = options.debounce ?? 800;
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [storedAt, setStoredAt] = useState<number | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 初次挂载：检查已有草稿
  useEffect(() => {
    const existing = readBlob<T>(key);
    if (existing) {
      setStoredAt(existing.ts);
      setHasDraft(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastJson = useRef<string | null>(null);
  // clearDraft 后抑制首次变更落盘（删除草稿 → 表单清空的防抖回写会制造幻影草稿）
  const suppressNext = useRef(false);

  useEffect(() => {
    if (options.enabled === false) return;
    const json = JSON.stringify(data);
    if (lastJson.current === null) {
      lastJson.current = json;
      return; // 首次渲染（恢复草稿回填本身触发的那次）不算 dirty
    }
    if (suppressNext.current) {
      suppressNext.current = false;
      lastJson.current = json;
      return; // 显式清除后的首次变更不落盘（删除草稿后空表单回写会制造幻影草稿）
    }
    if (json === lastJson.current) return;
    lastJson.current = json;
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const ts = Date.now();
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify({ v: 1, ts, data: JSON.parse(json) }));
      } catch { /* 存储满等异常静默 */ }
      setLastSavedAt(ts);
      setStoredAt(ts);
      setHasDraft(true);
    }, debounce);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(data), options.enabled, debounce]);

  const restoreDraft = useCallback((): unknown | null => {
    const blob = readBlob<T>(key);
    return blob ? blob.data : null;
  }, [key]);

  const clearDraft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    suppressNext.current = true;
    try {
      localStorage.removeItem(PREFIX + key);
    } catch { /* ignore */ }
    setHasDraft(false);
    setStoredAt(null);
    setDirty(false);
  }, [key]);

  const markClean = useCallback(() => setDirty(false), []);

  return { lastSavedAt, storedAt, hasDraft, dirty, restoreDraft, clearDraft, markClean };
}
