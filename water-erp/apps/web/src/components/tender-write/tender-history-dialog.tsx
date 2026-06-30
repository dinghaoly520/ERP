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
      <div className="panel-surface chromatic-glass glass-calm relative z-10 flex w-full max-w-[min(720px,92vw)] max-h-[80vh] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,248,255,0.88))] shadow-[0_30px_80px_rgba(59,89,143,0.18)]">
        <div className="border-b border-white/60 px-6 py-5">
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
              className="rounded-full border border-white/70 bg-white/80 p-2 text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]"
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
            <div className="rounded-[20px] border border-[rgba(230,129,102,0.16)] bg-[rgba(255,247,244,0.86)] px-4 py-4 text-sm text-[rgba(199,108,83,1)]">
              {errorMessage}
            </div>
          ) : records.length === 0 ? (
            <div className="rounded-[20px] border border-white/70 bg-white/72 px-5 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
              当前类型还没有保存记录。
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="rounded-[22px] border border-white/65 bg-white/78 px-4 py-4 shadow-[0_12px_28px_rgba(59,89,143,0.06)]"
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
                        className="rounded-full border border-[rgba(96,139,239,0.22)] bg-[rgba(96,139,239,0.1)] px-4 py-2 text-sm font-semibold text-[color:var(--accent)] transition-colors hover:bg-[rgba(96,139,239,0.16)]"
                      >
                        应用
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(record.id)}
                        disabled={deletingId === record.id}
                        className="rounded-full border border-[rgba(230,129,102,0.22)] bg-[rgba(230,129,102,0.1)] px-3 py-2 text-sm font-semibold text-[rgba(199,108,83,1)] transition-colors hover:bg-[rgba(230,129,102,0.16)] disabled:opacity-50"
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

        <div className="flex justify-end border-t border-white/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm font-semibold text-[color:var(--foreground)]"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
