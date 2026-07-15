"use client";

import { useEffect, useState, useCallback } from "react";
import { FileDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/workbench";
import {
  fetchNotificationLedger,
  updateNotificationLedger,
} from "@/lib/api/announcement";

function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

const HEADERS = [
  { key: "time", label: "时间", width: "min-w-[120px]" },
  { key: "category", label: "类别", width: "min-w-[140px]" },
  { key: "project", label: "项目", width: "min-w-[100px]" },
  { key: "projectName", label: "项目名称", width: "min-w-[340px]" },
  { key: "winnerName", label: "中标公司", width: "min-w-[260px]" },
  { key: "department", label: "需求部门", width: "min-w-[160px]" },
  { key: "controlPrice", label: "控制价", width: "min-w-[100px]" },
  { key: "winnerPrice", label: "中标价（元）", width: "min-w-[120px]" },
  { key: "procurementMethod", label: "采购方式", width: "min-w-[130px]" },
  { key: "remark", label: "备注", width: "min-w-[180px]" },
];

// Column indices: 0=序号(skip), 1=时间, 2=类别, 3=项目, 4=项目名称, 5=中标公司, 6=需求部门, 7=控制价, 8=中标价（元）, 9=采购方式, 10=备注

export function LedgerPreviewDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchNotificationLedger();
      // Convert all cells to strings
      const strRows = (data || []).map((row: unknown[]) =>
        row.map((cell) => String(cell ?? ""))
      );
      setRows(strRows);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "加载台账失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadLedger();
      setEditingCell(null);
    }
  }, [isOpen, loadLedger]);

  const handleCellChange = (rowIdx: number, colIdx: number, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[rowIdx] = [...next[rowIdx]];
      next[rowIdx][colIdx] = value;
      return next;
    });
  };

  const handleCellDoubleClick = (rowIdx: number, colIdx: number) => {
    setEditingCell({ row: rowIdx, col: colIdx });
  };

  const handleCellBlur = () => {
    setEditingCell(null);
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, Array(11).fill("")]);
  };

  const handleDeleteRow = (rowIdx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== rowIdx));
  };

  const handleExport = async () => {
    setExporting(true);
    setErrorMessage(null);
    try {
      const result = await updateNotificationLedger(rows);
      downloadBlobFile(result.blob, result.fileName);
      setSuccessMessage("导出成功！");
      setTimeout(() => setSuccessMessage(null), 2000);
      // Reload after export to sync 序号
      loadLedger();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "导出失败",
      );
    } finally {
      setExporting(false);
    }
  };

  const inputClass =
    "w-full min-h-[28px] rounded-md border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-2 py-1 text-xs text-[color:var(--foreground)] outline-none transition-all focus:border-[rgba(107,149,240,0.34)] focus:shadow-[0_0_0_2px_rgba(113,152,242,0.08)]";

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="中标通知书台账"
      description="台账管理"
      size="lg"
      className="!max-w-[min(1600px,95vw)]"
      footer={
        <>
          <button
            type="button"
            onClick={handleAddRow}
            className="tender-btn text-xs"
          >
            <Plus size={13} />
            新增行
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="tender-btn tender-btn--export disabled:cursor-not-allowed"
          >
            <span className="tb-icon tb-anim-bob">
              <FileDown size={13} />
            </span>
            {exporting ? "导出中..." : "导出台账"}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={20} className="animate-spin" />
          加载台账中...
        </div>
      ) : rows.length === 0 ? (
        <div className="py-20 text-center text-sm text-[color:var(--muted-foreground)]">
          台账为空，请先生成中标通知书或点击"新增行"手动添加。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[18px] border border-[rgba(230,236,248,0.82)]">
          <table className="w-max min-w-full text-xs">
            <thead>
              <tr className="border-b border-[rgba(230,236,248,0.82)] bg-[rgba(244,248,255,0.6)]">
                <th className="w-16 px-3 py-2.5 text-left font-semibold text-[color:var(--foreground)]">
                  序号
                </th>
                {HEADERS.map((h) => (
                  <th
                    key={h.key}
                    className={`${h.width} px-3 py-2.5 text-left font-semibold text-[color:var(--foreground)]`}
                  >
                    {h.label}
                  </th>
                ))}
                <th className="w-12 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => {
                // Col 0 = 序号, skip; editable cols: 1-10
                const colOffset = 1; // data cols start at index 1 (time)
                return (
                  <tr
                    key={rowIdx}
                    className="border-b border-white/40 transition-colors hover:bg-[rgba(244,248,255,0.3)]"
                  >
                    <td className="px-3 py-1.5 text-[color:var(--muted-foreground)]">
                      {rowIdx + 1}
                    </td>
                    {HEADERS.map((_, hi) => {
                      const colIdx = hi + colOffset;
                      const value = row[colIdx] ?? "";
                      const isEditing =
                        editingCell?.row === rowIdx &&
                        editingCell?.col === colIdx;

                      return (
                        <td key={hi} className="px-1.5 py-1">
                          {isEditing ? (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) =>
                                handleCellChange(
                                  rowIdx,
                                  colIdx,
                                  e.target.value,
                                )
                              }
                              onBlur={handleCellBlur}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCellBlur();
                                if (e.key === "Escape") handleCellBlur();
                              }}
                              className={inputClass}
                              autoFocus
                            />
                          ) : (
                            <div
                              className="min-h-[28px] cursor-text rounded-md px-2 py-1 text-[color:var(--foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)]"
                              onDoubleClick={() =>
                                handleCellDoubleClick(rowIdx, colIdx)
                              }
                              title="双击编辑"
                            >
                              {value || (
                                <span className="text-[rgba(230,129,102,0.3)]">
                                  —
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-1.5 py-1">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(rowIdx)}
                        className="neu-btn-xs is-danger"
                        title="删除行"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {errorMessage && (
        <div className="text-sm text-[color:var(--danger)]">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="rounded-[10px] border border-[color-mix(in_oklch,var(--success)_28%,transparent)] bg-[var(--success)] px-5 py-3 text-sm font-medium text-white">
          {successMessage}
        </div>
      )}
    </Modal>
  );
}
