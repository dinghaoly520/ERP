"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Clock, FileText, Loader2, Send, History, Pencil, Trash2, Archive, Undo2, RefreshCw, CalendarDays, Lock, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/workbench";
import {
  fetchAnnouncementHistory,
  fetchAllAnnouncementHistories,
  type AnnouncementHistoryItem,
  type AnnouncementHistoryAction,
} from "@/lib/api/announcement";

const ACTION_META: Record<AnnouncementHistoryAction, { label: string; icon: typeof FileText; cls: string }> = {
  CREATE: { label: "新建", icon: FileText, cls: "text-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]" },
  PUBLISH: { label: "发布", icon: Send, cls: "text-[rgba(42,140,110,0.92)] bg-[rgba(92,181,150,0.12)]" },
  UPDATE: { label: "编辑", icon: Pencil, cls: "text-[rgba(176,134,55,0.96)] bg-[rgba(233,194,111,0.14)]" },
  UNPUBLISH: { label: "撤回", icon: Undo2, cls: "text-[rgba(176,134,55,0.96)] bg-[rgba(233,194,111,0.14)]" },
  ARCHIVE: { label: "归档", icon: Archive, cls: "text-[var(--muted-foreground)] bg-[var(--muted)]/60" },
  DELETE: { label: "删除", icon: Trash2, cls: "text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)]" },
};

const FIELD_LABELS: Record<string, string> = {
  title: "标题", content: "正文", type: "类型", status: "状态", summary: "摘要",
  publishDate: "发布日期", isTop: "置顶", relatedProjectCode: "关联项目编号", metadata: "扩展信息",
};

/** 从 ISO 时间提取本地日期 YYYY-MM-DD（以天为单位的记录维度）。 */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 从 ISO 时间提取本地时分 HH:mm（日期已在分组头，行内仅显示时分）。 */
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** YYYY-MM-DD → 中文日期（如 2026-09-10 → 2026年9月10日）。 */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

/** 单条历史记录行（时间线式）：操作人 + 时分 + 变更字段（中文化），不再显示冗余指纹/IP。 */
function HistoryRow({ item, hideTitle = false }: { item: AnnouncementHistoryItem; hideTitle?: boolean }) {
  const meta = ACTION_META[item.action] ?? ACTION_META.UPDATE;
  const Icon = meta.icon;
  return (
    <div className="flex gap-3">
      {/* 时间线轴 */}
      <div className="flex flex-col items-center">
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${meta.cls}`}>
          <Icon size={14} strokeWidth={1.9} />
        </span>
        <span className="mt-1 w-px flex-1 bg-[var(--border)]" />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-[var(--foreground)]">{meta.label}</span>
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{localTime(item.createdAt)}</span>
          {!hideTitle && (
            <span className="truncate text-xs text-[var(--muted-foreground)]" title={item.title}>{item.title}</span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-[var(--muted-foreground)]">
          <div>
            操作人：<span className="font-medium text-[var(--foreground)]">{item.operatorName ?? "—"}</span>
          </div>
          {item.action === "UPDATE" && item.changedFields.length > 0 && (
            <div>
              变更字段：
              {item.changedFields.map((f) => (
                <span key={f} className="mr-1 inline-block rounded bg-[var(--muted)]/60 px-1.5 py-0.5">
                  {FIELD_LABELS[f] ?? f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 单条公告的操作时间线弹窗 */
export function AnnouncementHistoryModal({ announcementId, onClose }: { announcementId: string; onClose: () => void }) {
  const [items, setItems] = useState<AnnouncementHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnnouncementHistory(announcementId)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "加载历史失败"));
  }, [announcementId]);

  // 按天分组（后端 timeline 返回旧→新，反转为新→旧便于阅读）。
  const groups = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, AnnouncementHistoryItem[]>();
    for (const it of [...items].reverse()) {
      const day = localDay(it.createdAt);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(it);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <History size={16} className="text-[var(--accent)]" />
          操作历史
        </span>
      }
      description="该公告的全部操作记录，按天归档，只读不可修改"
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
            <Lock size={11} />只读记录{items ? ` · 共 ${items.length} 条` : ""}
          </span>
          <button type="button" onClick={onClose} className="neu-btn-soft">关闭</button>
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : items === null ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" /> 正在加载操作历史...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Clock size={20} strokeWidth={1.6} />
          暂无操作记录
        </div>
      ) : (
        <div className="max-h-[52vh] overflow-y-auto pr-1">
          {groups.map(([day, list]) => (
            <div key={day}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--foreground)]">{dayLabel(day)}</span>
                <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{list.length} 条</span>
              </div>
              {list.map((item) => <HistoryRow key={item.id} item={item} />)}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** 全部公告操作历史弹窗（公告管理总览）——按天分组，支持日期范围 + 操作类型 + 关键词检索。 */
export function AllAnnouncementHistoriesModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ items: AnnouncementHistoryItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const pageSize = 50;

  const doLoad = useCallback(async (p: number, action: string, df: string, dt: string, kw: string) => {
    setLoading(true);
    try {
      const res = await fetchAllAnnouncementHistories({
        page: p, pageSize,
        action: action || undefined,
        dateFrom: df || undefined,
        dateTo: dt || undefined,
        search: kw || undefined,
      });
      setData({ items: res.items, total: res.total });
      setPage(res.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载历史失败");
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => { doLoad(1, "", "", "", ""); }, [doLoad]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  // 按天分组（后端返回新→旧，Map 保持日期从新到旧）。
  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, AnnouncementHistoryItem[]>();
    for (const item of data.items) {
      const day = localDay(item.createdAt);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(item);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <History size={16} className="text-[var(--accent)]" />
          公告操作历史
        </span>
      }
      description="全部公告的操作流水，按天归档，只读不可修改"
      size="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
            <Lock size={11} />只读记录 · 共 {data?.total ?? 0} 条
          </span>
          <button type="button" onClick={onClose} className="neu-btn-soft">关闭</button>
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : (
        <div className="space-y-3">
          {/* 筛选：操作类型 + 日期范围 + 关键词 */}
          <div className="wb-toolbar !px-3 !py-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">操作类型</span>
            <select
              value={actionFilter}
              onChange={e => { const v = e.target.value; setActionFilter(v); doLoad(1, v, dateFrom, dateTo, search); }}
              className="workbench-input !w-auto !h-7 !text-[11px] min-w-[110px]"
            >
              <option value="">全部</option>
              {Object.entries(ACTION_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>

            <span className="text-[11px] font-semibold text-[var(--muted-foreground)] flex items-center gap-1">
              <CalendarDays size={12} />日期
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => { const v = e.target.value; setDateFrom(v); doLoad(1, actionFilter, v, dateTo, search); }}
              className="workbench-input !w-auto !h-7 !text-[11px]"
            />
            <span className="text-[11px] text-[var(--muted-foreground)]">至</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => { const v = e.target.value; setDateTo(v); doLoad(1, actionFilter, dateFrom, v, search); }}
              className="workbench-input !w-auto !h-7 !text-[11px]"
            />

            <div className="relative min-w-[120px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                placeholder="搜索标题…"
                value={search}
                onChange={e => { const v = e.target.value; setSearch(v); doLoad(1, actionFilter, dateFrom, dateTo, v); }}
                className="workbench-input !h-7 !text-[11px] !pl-8"
              />
            </div>

            <button onClick={() => doLoad(page, actionFilter, dateFrom, dateTo, search)} disabled={loading} className="neu-btn-xs gap-1" aria-label="刷新">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* 列表（按天分组） */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" /> 正在加载...
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
              <History size={20} strokeWidth={1.6} />
              暂无操作记录
            </div>
          ) : (
            <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
              {groups.map(([day, list]) => (
                <div key={day}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--foreground)]">{dayLabel(day)}</span>
                    <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{list.length} 条</span>
                  </div>
                  <div className="space-y-2">
                    {list.map((item) => <HistoryRow key={item.id} item={item} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {(data?.total ?? 0) > pageSize && (
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => doLoad(page - 1, actionFilter, dateFrom, dateTo, search)} disabled={page <= 1 || loading} className="neu-btn-xs gap-1">
                <ChevronLeft size={12} />上一页
              </button>
              <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{page} / {totalPages}</span>
              <button onClick={() => doLoad(page + 1, actionFilter, dateFrom, dateTo, search)} disabled={page >= totalPages || loading} className="neu-btn-xs gap-1">
                下一页<ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
