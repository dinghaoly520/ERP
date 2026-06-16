'use client';
import { useEffect, useRef, useCallback } from 'react';

const AUTOSAVE_MS = 3_000;

/** Autosave form data to localStorage. Returns { clear } to clear the saved draft. */
export function useFormAutosave<T extends Record<string, unknown>>(
  key: string,
  state: T,
  enabled = true,
) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    timer.current = setInterval(() => {
      try {
        const payload = JSON.stringify({ ...state, _savedAt: Date.now() });
        localStorage.setItem(`erp:draft:${key}`, payload);
      } catch { /* quota exceeded */ }
    }, AUTOSAVE_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [key, state, enabled]);

  /** 读取已保存草稿，若无返回 null */
  const getDraft = useCallback((): (T & { _savedAt: number }) | null => {
    try {
      const raw = localStorage.getItem(`erp:draft:${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?._savedAt) return parsed;
      return null;
    } catch { return null; }
  }, [key]);

  /** 清除草稿 */
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(`erp:draft:${key}`); } catch { /* */ }
  }, [key]);

  return { getDraft, clearDraft };
}

/** Warn on unsaved changes when navigating away (used with beforeunload). */
export function useUnsavedGuard(hasChanges: boolean) {
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);
}
