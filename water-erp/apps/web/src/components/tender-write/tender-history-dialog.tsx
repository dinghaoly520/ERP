"use client";

import { useEffect, useState } from "react";
import { History, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { clearTenderHistoryByType, fetchTenderHistory } from "@/lib/api/tender-history";
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

/** 版本条目主标：2026/11/12 10:42（与项目侧版本 label 同构）。 */
function formatVersionLabel(createdAt: string) {
  return new Date(createdAt).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TenderHistoryDialog({
  isOpen,
  documentType,
  onApply,
  onClose,
}: TenderHistoryDialogProps) {
  const [records, setRecords] = useState<TenderHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
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
      <div className="wb-modal-shell relative z-10 mx-2 w-full max-w-[440px] overflow-y-auto p-6">
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
          <div className="mb-4 mt-4 space-y-2">
            {records.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => {
                  onApply(record);
                  toast.success(`已恢复 ${formatVersionLabel(record.createdAt)} 版本`);
                }}
                className="w-full rounded-[12px] bg-[oklch(1_0_0_/_0.48)] px-3.5 py-3 text-left shadow-[inset_0_1px_0_oklch(1_0_0_/_0.5)] transition hover:ring-1 hover:ring-[var(--accent)]/30"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[color:var(--foreground)]">
                    {formatVersionLabel(record.createdAt)}
                  </span>
                  <span className="text-[10px] text-[var(--accent)]">点击恢复</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <p className="mb-3 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
          点击任意版本即可恢复草稿内容。草稿与历史版本已同步至服务器，同一账号在任何设备登录均保持一致。
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
  );
}
