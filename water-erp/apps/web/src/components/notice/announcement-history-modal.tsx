"use client";

import { useEffect, useState } from "react";
import { Clock, FileText, Loader2, Send, History, Pencil, Trash2, Archive, Undo2 } from "lucide-react";
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

function HistoryRow({ item }: { item: AnnouncementHistoryItem }) {
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
          <span className="text-xs text-[var(--muted-foreground)]">
            {new Date(item.createdAt).toLocaleString("zh-CN")}
          </span>
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-[var(--muted-foreground)]">
          <div>
            操作人：<span className="font-medium text-[var(--foreground)]">{item.operatorName ?? "—"}</span>
            {item.ipAddress && <span className="ml-2 opacity-70">{item.ipAddress}</span>}
          </div>
          <div className="truncate" title={item.title}>标题：{item.title}</div>
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
          {item.contentHash && (
            <div className="font-mono text-[10px] opacity-60">
              正文指纹 {item.contentHash.slice(0, 16)}…（{item.contentLength ?? 0} 字符）
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

  return (
    <Modal
      open
      onClose={onClose}
      title="操作历史"
      description="该公告的全部操作记录（只读，不可修改删减）"
      size="lg"
      footer={
        <button type="button" onClick={onClose} className="neu-btn-soft">关闭</button>
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
          {items.map((item) => <HistoryRow key={item.id} item={item} />)}
        </div>
      )}
    </Modal>
  );
}

/** 全部公告操作历史弹窗（公告管理总览） */
export function AllAnnouncementHistoriesModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ items: AnnouncementHistoryItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllAnnouncementHistories({ pageSize: 100 })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "加载历史失败"));
  }, []);

  return (
    <Modal
      open
      onClose={onClose}
      title="公告操作历史"
      description={`全部公告的操作流水（只读，不可修改删减）${data ? ` · 共 ${data.total} 条` : ""}`}
      size="2xl"
      footer={
        <button type="button" onClick={onClose} className="neu-btn-soft">关闭</button>
      }
    >
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : data === null ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" /> 正在加载...
        </div>
      ) : data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <History size={20} strokeWidth={1.6} />
          暂无操作记录
        </div>
      ) : (
        <div className="max-h-[56vh] overflow-y-auto pr-1">
          {data.items.map((item) => <HistoryRow key={item.id} item={item} />)}
        </div>
      )}
    </Modal>
  );
}
