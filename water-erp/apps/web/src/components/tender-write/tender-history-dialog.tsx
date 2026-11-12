"use client";

import { useEffect, useState } from "react";
import { Clock3, History, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  clearTenderHistoryByType,
  deleteTenderHistory,
  fetchTenderHistory,
} from "@/lib/api/tender-history";
import type {
  TenderDocumentType,
  TenderHistoryRecord,
} from "@/lib/types/tender-write";

/** 与项目侧弹窗 MAX_HISTORY 同源的服务端记录上限（tender-history.service MAX_RECORDS_PER_TYPE）。 */
const MAX_RECORDS = 20;

type TenderHistoryDialogProps = {
  isOpen: boolean;
  documentType: TenderDocumentType;
  onApply: (record: TenderHistoryRecord) => void;
  onClose: () => void;
};

/** 记录时间戳：2026/11/12 10:42（与项目侧版本 label 同构）。 */
function formatVersionLabel(createdAt: string) {
  return new Date(createdAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 工具栏侧（/tender-write）历史记录弹窗——2026-11-12 对齐项目侧「草稿历史版本」组件框，
 * 但保留本侧特有信息与操作：历史跨所有项目（记录带标题区分）+ 单条「应用/删除」。
 */
export function TenderHistoryDialog({
  isOpen,
  documentType,
  onApply,
  onClose,
}: TenderHistoryDialogProps) {
  const [records, setRecords] = useState<TenderHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRecords = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchTenderHistory(documentType);
      setRecords(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载历史记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    loadRecords();
  }, [documentType, isOpen]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await deleteTenderHistory(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setErrorMessage(null);
    try {
      await clearTenderHistoryByType(documentType);
      setRecords([]);
      toast.success("已清空历史记录");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "清空历史失败");
    } finally {
      setClearing(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-[rgba(242,246,255,0.42)] backdrop-blur-md"
        onClick={onClose}
      />
      <div className="wb-modal-shell relative z-10 mx-2 flex max-h-[80vh] w-full max-w-[440px] flex-col overflow-hidden p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[color:var(--foreground)]">
              草稿历史版本
            </span>
            {records.length > 0 && (
              <span className="text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
                {records.length}/{MAX_RECORDS}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="neu-btn-xs"
            aria-label="关闭历史记录弹窗"
          >
            <X size={16} />
          </button>
        </div>
        <div className="h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              正在加载历史记录...
            </div>
          ) : errorMessage ? (
            <div className="my-4 rounded-[12px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-4 text-sm text-[color:var(--danger)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--danger)_20%,transparent)]">
              {errorMessage}
            </div>
          ) : records.length === 0 ? (
            <div className="py-8 text-center text-sm text-[color:var(--muted-foreground)]">
              暂无历史版本，请点击「保存当前」创建第一个版本
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="rounded-[12px] bg-[#f4f7fc] px-3.5 py-3 shadow-[inset_0_1px_0_oklch(1_0_0_/_0.8),2px_2px_5px_oklch(0.55_0.03_258_/_0.12),-1px_-1px_3px_oklch(1_0_0_/_0.9)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                        {record.title}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)]">
                        <Clock3 size={12} />
                        <span className="tabular-nums">
                          {formatVersionLabel(record.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onApply(record);
                          toast.success(`已应用「${record.title}」草稿`);
                        }}
                        className="neu-btn-xs"
                      >
                        应用
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(record.id)}
                        disabled={deletingId === record.id}
                        className="neu-btn-xs is-danger"
                        title="删除此记录"
                      >
                        {deletingId === record.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 shrink-0">
          <p className="mb-3 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
            点击「应用」即可恢复该条草稿内容。草稿与历史版本已同步至服务器，同一账号在任何设备登录均保持一致。
          </p>
          <div className="flex justify-end gap-2">
            {records.length > 0 && (
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={clearing}
                className="neu-btn-xs is-danger gap-1"
              >
                {clearing ? <Loader2 size={14} className="animate-spin" /> : null}
                清空历史
              </button>
            )}
            <button type="button" onClick={onClose} className="neu-btn-soft">
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
