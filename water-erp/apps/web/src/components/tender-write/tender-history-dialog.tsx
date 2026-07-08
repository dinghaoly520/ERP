"use client";

import { useEffect, useState } from "react";
import { Clock3, History, Loader2, Trash2, X } from "lucide-react";
import { deleteTenderHistory, fetchTenderHistory } from "@/lib/api/tender-history";
import type {
  TenderDocumentType,
  TenderHistoryRecord,
} from "@/lib/types/tender-write";

type TenderHistoryDialogProps = {
  isOpen: boolean;
  documentType: TenderDocumentType;
  documentLabel: string;
  onApply: (record: TenderHistoryRecord) => void;
  onClose: () => void;
};

export function TenderHistoryDialog({
  isOpen,
  documentType,
  documentLabel,
  onApply,
  onClose,
}: TenderHistoryDialogProps) {
  const [records, setRecords] = useState<TenderHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-[rgba(242,246,255,0.42)] backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative z-10 flex w-full max-w-[min(720px,92vw)] max-h-[80vh] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        <div className="px-6 py-5" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(94,126,189,0.76)]">
                历史记录
              </div>
              <div className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
                {documentLabel}
              </div>
              <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                仅展示当前所选类型的保存记录，点击"应用"即可一次性导入全部填写内容。
              </p>
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 size={16} className="animate-spin" />
              正在加载历史记录...
            </div>
          ) : errorMessage ? (
            <div className="rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_20%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-4 text-sm text-[color:var(--danger)]">
              {errorMessage}
            </div>
          ) : records.length === 0 ? (
            <div className="wb-panel flex items-center justify-center px-5 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
              当前类型还没有保存记录。
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="neu-card-static !rounded-[16px] px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[color:var(--foreground)]">
                        {record.title}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <Clock3 size={13} />
                        <span>
                          {new Date(record.createdAt).toLocaleString("zh-CN", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onApply(record)}
                        className="neu-btn-soft"
                      >
                        应用
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(record.id)}
                        disabled={deletingId === record.id}
                        className="neu-btn-soft is-danger"
                        title="删除此记录"
                      >
                        {deletingId === record.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <button type="button" onClick={onClose} className="neu-btn-soft"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
