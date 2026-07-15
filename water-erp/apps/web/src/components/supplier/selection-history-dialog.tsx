"use client";

import { useEffect, useState } from "react";
import { Clock3, History, Loader2, Trash2, Search, RotateCcw } from "lucide-react";
import { getSelectionHistory, deleteSelectionHistory, restoreShortlist } from "@/lib/api/supplier";
import type { SupplierSelectionHistoryRecord, SupplierRecommendation } from "@/lib/api/supplier";
import { Modal } from "@/components/workbench";

type Props = {
  isOpen: boolean;
  onApply: (record: SupplierSelectionHistoryRecord) => void;
  onApplyShortlist: (record: SupplierSelectionHistoryRecord, items: SupplierRecommendation[]) => void;
  onClose: () => void;
};

export function SelectionHistoryDialog({ isOpen, onApply, onApplyShortlist, onClose }: Props) {
  const [records, setRecords] = useState<SupplierSelectionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRecords = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await getSelectionHistory();
      setRecords(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载历史记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadRecords();
  }, [isOpen]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await deleteSelectionHistory(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  const truncate = (text: string, maxLen = 80) =>
    text.length > maxLen ? text.slice(0, maxLen) + "…" : text;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="历史选取记录"
      description="点击「应用」将恢复当时的采购需求与筛选条件，便于复用或对比。"
      size="lg"
    >
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
            <div className="neu-card-static !rounded-[16px] flex flex-col items-center justify-center px-5 py-12 text-center">
              <History size={32} className="text-[var(--muted-foreground)]/30 mb-4" />
              <p className="text-sm text-[color:var(--muted-foreground)]">
                暂无选取记录
              </p>
              <p className="mt-1 text-xs text-[color:var(--muted-foreground)]/60">
                每次智能推荐成功后，系统会自动保存选取历史
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="neu-card-static !rounded-[16px] px-4 py-4"
                >
                  <div className="flex flex-col gap-3">
                    {/* requirement preview */}
                    <div className="flex items-start gap-2.5">
                      <Search
                        size={15}
                        className="mt-0.5 flex-shrink-0 text-[var(--muted-foreground)]/50"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[color:var(--foreground)] leading-relaxed line-clamp-2">
                          {truncate(record.requirement)}
                        </p>
                      </div>
                    </div>

                    {/* meta row */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[color:var(--muted-foreground)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 size={12} />
                        {new Date(record.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {record.classificationName && (
                        <span className="rounded-md bg-[var(--accent)]/8 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                          {record.classificationName}
                        </span>
                      )}
                      <span>
                        推荐{" "}
                        <strong className="text-[color:var(--foreground)]">
                          {record.recommendationCount}
                        </strong>{" "}
                        家 · 候选池{" "}
                        <strong className="text-[color:var(--foreground)]">
                          {record.candidatePool}
                        </strong>{" "}
                        家
                      </span>
                      {record.shortlistedIds?.length > 0 && (
                        <span className="rounded-md bg-[var(--success)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                          已选 {record.shortlistedIds.length} 家
                        </span>
                      )}
                    </div>

                    {/* actions */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onApply(record)}
                        className="neu-btn-soft text-xs"
                      >
                        <Search size={13} />
                        应用筛选
                      </button>
                      {record.shortlistedIds?.length > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            setRestoringId(record.id);
                            try {
                              const items = await restoreShortlist(record.id);
                              onApplyShortlist(record, items);
                            } catch {
                              /* ignore */
                            } finally {
                              setRestoringId(null);
                            }
                          }}
                          disabled={restoringId === record.id}
                          className="neu-btn-soft text-xs"
                          title="恢复候选名单"
                        >
                          {restoringId === record.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <RotateCcw size={13} />
                          )}
                          恢复名单
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(record.id)}
                        disabled={deletingId === record.id}
                        className="neu-btn-soft is-danger text-xs"
                        title="删除此记录"
                      >
                        {deletingId === record.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
    </Modal>
  );
}
