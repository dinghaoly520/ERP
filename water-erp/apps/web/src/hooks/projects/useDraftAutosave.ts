import { useCallback, useEffect, useRef } from 'react';

const PREFIX = 'tender-draft:';

export interface DraftData {
  html: string;
  savedAt: number;
}

export function loadDraft(attachmentId: string): DraftData | null {
  try {
    const raw = localStorage.getItem(PREFIX + attachmentId);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

export function clearDraft(attachmentId: string) {
  try {
    localStorage.removeItem(PREFIX + attachmentId);
  } catch {
    /* ignore */
  }
}

/**
 * 防抖（2s）把编辑器 HTML 写入 localStorage，按 attachmentId 分键。
 * 调用方在内容变化时调用返回的 scheduleSave（例如 MutationObserver 的 debounce 回调里）。
 * 保存成功 / 重置后由调用方 clearDraft。
 */
export function useDraftAutosave(attachmentId: string, getHtml: () => string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getHtmlRef = useRef(getHtml);
  getHtmlRef.current = getHtml;

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!attachmentId) return;
      try {
        const html = getHtmlRef.current();
        if (html) {
          localStorage.setItem(
            PREFIX + attachmentId,
            JSON.stringify({ html, savedAt: Date.now() }),
          );
        }
      } catch {
        /* 配额满等：静默 */
      }
    }, 2000);
  }, [attachmentId]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attachmentId]);

  return scheduleSave;
}
