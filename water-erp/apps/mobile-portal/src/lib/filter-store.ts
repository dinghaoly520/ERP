/**
 * 筛选记忆（2026-10-14 spec）：localStorage 单 key 分页存；
 * 搜索词不记忆（瞬态意图）。隐私模式/存储异常静默降级。
 */
const KEY = "mobile-portal:filters";

export function readSavedFilters<T>(page: string): Partial<T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, unknown>;
    return (all[page] ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

export function saveFilters(page: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    all[page] = value;
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 存储不可用忽略 */
  }
}
