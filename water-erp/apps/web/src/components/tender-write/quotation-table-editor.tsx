"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Merge, Split, Plus, Minus, ArrowDown, ArrowRight, Undo2 } from "lucide-react";
import {
  createTableHistoryState,
  popTableHistory,
  recordTableEdit,
  type TableHistoryState,
} from "@/lib/tender-write/table-history";

export type TableCell = {
  content: string;
  rowSpan: number;
  colSpan: number;
  align: "left" | "center" | "right";
  hidden?: boolean;
};

export type TableData = {
  rows: number;
  cols: number;
  cells: TableCell[][];
};

// 报价表文本↔表格转换原语 2026-11-12 迁至 lib（storage 归一化需要引用）；
// 此处 re-export 保 modal/preview 等既有 import 路径兼容
export { createDefaultQuotationTable, parseQuotationTextToTable } from "@/lib/tender-write/quotation-table-text";

export function parseTableFromHtml(html: string): TableData | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const table = doc.querySelector("table");

  if (!table) return null;

  const rows = table.querySelectorAll("tr");
  if (rows.length === 0) return null;

  const cells: TableCell[][] = [];
  const occupied: boolean[][] = [];

  rows.forEach((row, rowIndex) => {
    cells[rowIndex] = [];
    occupied[rowIndex] = [];
    const cols = row.querySelectorAll("td, th");
    let colIndex = 0;

    cols.forEach((cell) => {
      while (occupied[rowIndex][colIndex]) {
        colIndex++;
      }

      const rowSpan = parseInt(cell.getAttribute("rowspan") || "1", 10);
      const colSpan = parseInt(cell.getAttribute("colspan") || "1", 10);
      const style = cell.getAttribute("style") || "";
      let align: "left" | "center" | "right" = "left";
      if (style.includes("text-align: center")) align = "center";
      else if (style.includes("text-align: right")) align = "right";

      cells[rowIndex][colIndex] = {
        content: cell.textContent?.trim() || "",
        rowSpan,
        colSpan,
        align,
      };

      for (let r = 0; r < rowSpan; r++) {
        for (let c = 0; c < colSpan; c++) {
          if (!occupied[rowIndex + r]) occupied[rowIndex + r] = [];
          occupied[rowIndex + r][colIndex + c] = true;
        }
      }

      colIndex++;
    });
  });

  const maxCols = Math.max(...occupied.map((row) => row.filter(Boolean).length));

  return {
    rows: cells.length,
    cols: maxCols,
    cells,
  };
}

export function createEmptyTableData(rows: number, cols: number): TableData {
  const cells: TableCell[][] = [];
  for (let r = 0; r < rows; r++) {
    cells[r] = [];
    for (let c = 0; c < cols; c++) {
      cells[r][c] = {
        content: "",
        rowSpan: 1,
        colSpan: 1,
        align: "left",
      };
    }
  }
  return { rows, cols, cells };
}

/** 在 cells 中查找覆盖 (r,c) 的锚点单元格（用于定位 hidden 单元所属的合并格）。 */
function findCellAnchor(cells: TableCell[][], r: number, c: number) {
  for (let rr = 0; rr <= r; rr++) {
    for (let cc = 0; cc <= c; cc++) {
      const cand = cells[rr]?.[cc];
      if (cand && !cand.hidden && rr + cand.rowSpan > r && cc + cand.colSpan > c) {
        return { r: rr, c: cc, cell: cand };
      }
    }
  }
  return null;
}

/**
 * 将选区矩形扩展到完整覆盖所有与其相交的合并单元格，
 * 保证合并/选区操作不会拆碎已有的合并格。
 */
function normalizeSelectionRect(
  cells: TableCell[][],
  minR: number,
  minC: number,
  maxR: number,
  maxC: number,
) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const cell = cells[r]?.[c];
        if (!cell) continue;
        let ar = r;
        let ac = c;
        let spanR = cell.rowSpan;
        let spanC = cell.colSpan;
        if (cell.hidden) {
          const anchor = findCellAnchor(cells, r, c);
          if (!anchor) continue;
          ar = anchor.r;
          ac = anchor.c;
          spanR = anchor.cell.rowSpan;
          spanC = anchor.cell.colSpan;
        }
        const endR = ar + spanR - 1;
        const endC = ac + spanC - 1;
        if (ar < minR) { minR = ar; changed = true; }
        if (ac < minC) { minC = ac; changed = true; }
        if (endR > maxR) { maxR = endR; changed = true; }
        if (endC > maxC) { maxC = endC; changed = true; }
      }
    }
  }
  return { minR, minC, maxR, maxC };
}

/** 矩形区域 → 选区 key 集合。 */
function rectToSelection(minR: number, minC: number, maxR: number, maxC: number) {
  const set = new Set<string>();
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) set.add(`${r}-${c}`);
  }
  return set;
}

type QuotationTableEditorProps = {
  value: TableData;
  onChange: (data: TableData) => void;
};

export function QuotationTableEditor({ value, onChange }: QuotationTableEditorProps) {
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ row: number; col: number } | null>(null);
  /** 本轮按下期间是否已移出起始格（移出后切换为区域选择模式）。 */
  const dragMovedRef = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);

  // 撤回历史：所有改动经 commit 收口，改动前快照入栈（同格连续打字合并为一步）。
  // 历史随组件存活——切走章节或切回「填入文字」再回来即清空（表格数据本身不丢）。
  const [undoState, setUndoState] = useState<TableHistoryState>(createTableHistoryState);
  // 追踪最近一次已知 value：用于识别「外部整体替换」（AI 优化表格、应用历史记录）——
  // 这类写入不经过 commit，靠对比 prop 变化把替换前状态补进撤回栈
  const lastValueRef = useRef(value);

  const commit = useCallback(
    (next: TableData, editCell: { r: number; c: number } | null = null) => {
      lastValueRef.current = next;
      setUndoState((prev) => recordTableEdit(prev, value, editCell));
      onChange(next);
    },
    [value, onChange]
  );

  const handleUndo = useCallback(() => {
    const { state, snapshot } = popTableHistory(undoState);
    if (!snapshot) return;
    lastValueRef.current = snapshot;
    setUndoState(state);
    onChange(snapshot);
    // 选区可能指向撤回后已不存在的行列，直接清空
    setSelectedCells(new Set());
  }, [undoState, onChange]);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      const previous = lastValueRef.current;
      lastValueRef.current = value;
      setUndoState((prev) => recordTableEdit(prev, previous, null));
    }
  }, [value]);

  // 鼠标在表格外释放时也结束拖动，避免下次移入继续误扩选区
  useEffect(() => {
    const endDrag = () => {
      setIsDragging(false);
      setDragStart(null);
    };
    window.addEventListener("mouseup", endDrag);
    return () => window.removeEventListener("mouseup", endDrag);
  }, []);

  const handleCellChange = useCallback(
    (rowIndex: number, colIndex: number, content: string) => {
      const newCells = value.cells.map((row, r) =>
        row.map((cell, c) => (r === rowIndex && c === colIndex ? { ...cell, content } : cell))
      );
      commit({ ...value, cells: newCells }, { r: rowIndex, c: colIndex });
    },
    [value, commit]
  );

  const handleCellAlign = useCallback(
    (align: "left" | "center" | "right") => {
      if (selectedCells.size === 0) return;

      const newCells = value.cells.map((row, r) =>
        row.map((cell, c) => {
          const key = `${r}-${c}`;
          return selectedCells.has(key) ? { ...cell, align } : cell;
        })
      );
      commit({ ...value, cells: newCells });
    },
    [value, commit, selectedCells]
  );

  const handleMergeCells = useCallback(() => {
    if (selectedCells.size < 2) return;

    const positions = Array.from(selectedCells).map((key) => {
      const [r, c] = key.split("-").map(Number);
      return { r, c };
    });

    // 扩展到完整覆盖相交的合并格，避免拆碎已有合并
    const { minR, minC, maxR, maxC } = normalizeSelectionRect(
      value.cells,
      Math.min(...positions.map((p) => p.r)),
      Math.min(...positions.map((p) => p.c)),
      Math.max(...positions.map((p) => p.r)),
      Math.max(...positions.map((p) => p.c)),
    );

    const mergedContent: string[] = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const cell = value.cells[r]?.[c];
        if (cell && !cell.hidden && cell.content.trim()) mergedContent.push(cell.content.trim());
      }
    }

    const newCells = value.cells.map((row, r) =>
      row.map((cell, c) => {
        if (r < minR || r > maxR || c < minC || c > maxC) return cell;
        if (r === minR && c === minC) {
          return {
            ...cell,
            hidden: false,
            rowSpan: maxR - minR + 1,
            colSpan: maxC - minC + 1,
            content: mergedContent.join(" "),
          };
        }
        return { ...cell, hidden: true, rowSpan: 1, colSpan: 1, content: "" };
      })
    );

    commit({ ...value, cells: newCells });
    // 保留锚点选中，合并后可直接拆分
    setSelectedCells(new Set([`${minR}-${minC}`]));
  }, [value, commit, selectedCells]);

  const handleSplitCells = useCallback(() => {
    if (selectedCells.size !== 1) return;

    const key = Array.from(selectedCells)[0];
    const [rowIndex, colIndex] = key.split("-").map(Number);
    const cell = value.cells[rowIndex]?.[colIndex];

    if (!cell || (cell.rowSpan === 1 && cell.colSpan === 1)) return;

    const newCells = value.cells.map((row, r) =>
      row.map((c, colIdx) => {
        if (r >= rowIndex && r < rowIndex + cell.rowSpan && colIdx >= colIndex && colIdx < colIndex + cell.colSpan) {
          return {
            ...c,
            rowSpan: 1,
            colSpan: 1,
            hidden: false,
            content: r === rowIndex && colIdx === colIndex ? cell.content : "",
          };
        }
        return c;
      })
    );

    commit({ ...value, cells: newCells });
    setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
  }, [value, commit, selectedCells]);

  const handleCellMouseDown = useCallback((rowIndex: number, colIndex: number, e: React.MouseEvent) => {
    // 仅响应鼠标左键
    if (e.button !== 0) return;

    // Ctrl/Cmd+click: toggle single cell in selection
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedCells((prev) => {
        const newSet = new Set(prev);
        const key = `${rowIndex}-${colIndex}`;
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return newSet;
      });
      return;
    }

    // Shift+click: extend selection from first selected cell (auto-expand over merged cells)
    if (e.shiftKey && selectedCells.size > 0) {
      e.preventDefault();
      const firstKey = Array.from(selectedCells)[0];
      const [anchorRow, anchorCol] = firstKey.split("-").map(Number);
      const rect = normalizeSelectionRect(
        value.cells,
        Math.min(anchorRow, rowIndex),
        Math.min(anchorCol, colIndex),
        Math.max(anchorRow, rowIndex),
        Math.max(anchorCol, colIndex),
      );
      setSelectedCells(rectToSelection(rect.minR, rect.minC, rect.maxR, rect.maxC));
      return;
    }

    // 普通左键按下：不 preventDefault，保留输入框聚焦/光标定位（单击仍可编辑文字）。
    // 开始追踪拖动——若移出当前格，mouseEnter 中切换为区域选择模式。
    setIsDragging(true);
    dragMovedRef.current = false;
    setDragStart({ row: rowIndex, col: colIndex });
    setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
  }, [selectedCells, value.cells]);

  const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
    if (!isDragging || !dragStart) return;
    if (rowIndex === dragStart.row && colIndex === dragStart.col) return;

    // 移出起始格 → 区域选择模式：失焦正在编辑的输入框，避免与文字选择冲突
    dragMovedRef.current = true;
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName === "INPUT" && tableRef.current?.contains(active)) {
      active.blur();
    }

    const rect = normalizeSelectionRect(
      value.cells,
      Math.min(dragStart.row, rowIndex),
      Math.min(dragStart.col, colIndex),
      Math.max(dragStart.row, rowIndex),
      Math.max(dragStart.col, colIndex),
    );
    setSelectedCells(rectToSelection(rect.minR, rect.minC, rect.maxR, rect.maxC));
  }, [isDragging, dragStart, value.cells]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const html = e.clipboardData.getData("text/html");
      const text = e.clipboardData.getData("text/plain");

      if (html) {
        const parsed = parseTableFromHtml(html);
        if (parsed) {
          commit(parsed);
          return;
        }
      }

      if (text) {
        const lines = text.split("\n").filter(Boolean);
        const cells = lines.map((line) =>
          line.split("\t").map((content) => ({
            content: content.trim(),
            rowSpan: 1,
            colSpan: 1,
            align: "left" as const,
          }))
        );
        const maxCols = Math.max(...cells.map((row) => row.length));
        commit({ rows: cells.length, cols: maxCols, cells });
      }
    },
    [commit]
  );

  // 归一化后的选区矩形（完整覆盖相交的合并格）
  const selectionRect = (() => {
    if (selectedCells.size === 0) return null;
    const positions = Array.from(selectedCells).map((key) => {
      const [r, c] = key.split("-").map(Number);
      return { r, c };
    });
    return normalizeSelectionRect(
      value.cells,
      Math.min(...positions.map((p) => p.r)),
      Math.min(...positions.map((p) => p.c)),
      Math.max(...positions.map((p) => p.r)),
      Math.max(...positions.map((p) => p.c)),
    );
  })();

  const canMerge = (() => {
    if (!selectionRect) return false;
    let visible = 0;
    for (let r = selectionRect.minR; r <= selectionRect.maxR && visible < 2; r++) {
      for (let c = selectionRect.minC; c <= selectionRect.maxC && visible < 2; c++) {
        const cell = value.cells[r]?.[c];
        if (cell && !cell.hidden) visible++;
      }
    }
    return visible >= 2;
  })();

  const canSplit = selectedCells.size === 1 && (() => {
    const key = Array.from(selectedCells)[0];
    const [r, c] = key.split("-").map(Number);
    const cell = value.cells[r]?.[c];
    return !!cell && !cell.hidden && (cell.rowSpan > 1 || cell.colSpan > 1);
  })();

  // Get selected row/column for insert/delete operations
  const selectedRow = selectedCells.size === 1 ? parseInt(Array.from(selectedCells)[0].split("-")[0]) : -1;
  const selectedCol = selectedCells.size === 1 ? parseInt(Array.from(selectedCells)[0].split("-")[1]) : -1;
  const canInsertRow = selectedRow >= 0 && value.rows < 20;
  const canDeleteRow = selectedRow >= 0 && value.rows > 1;
  const canInsertCol = selectedCol >= 0 && value.cols < 10;
  const canDeleteCol = selectedCol >= 0 && value.cols > 1;

  const handleInsertRowAbove = useCallback(() => {
    if (selectedRow < 0 || value.rows >= 20) return;

    const newCells: TableCell[][] = [];
    for (let r = 0; r <= value.rows; r++) {
      newCells[r] = [];
      for (let c = 0; c < value.cols; c++) {
        if (r < selectedRow) {
          newCells[r][c] = value.cells[r]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else if (r === selectedRow) {
          // New empty row — 默认居中
          newCells[r][c] = { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else {
          newCells[r][c] = value.cells[r - 1]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        }
      }
    }
    commit({ rows: value.rows + 1, cols: value.cols, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${selectedCol}`]));
  }, [selectedRow, value, commit, selectedCol]);

  const handleInsertRowBelow = useCallback(() => {
    if (selectedRow < 0 || value.rows >= 20) return;

    const insertIndex = selectedRow + 1;
    const newCells: TableCell[][] = [];
    for (let r = 0; r <= value.rows; r++) {
      newCells[r] = [];
      for (let c = 0; c < value.cols; c++) {
        if (r < insertIndex) {
          newCells[r][c] = value.cells[r]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else if (r === insertIndex) {
          // New empty row — 默认居中
          newCells[r][c] = { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else {
          newCells[r][c] = value.cells[r - 1]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        }
      }
    }
    commit({ rows: value.rows + 1, cols: value.cols, cells: newCells });
    setSelectedCells(new Set([`${insertIndex}-${selectedCol}`]));
  }, [selectedRow, value, commit, selectedCol]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRow < 0 || value.rows <= 1) return;

    const newCells: TableCell[][] = value.cells
      .filter((_, r) => r !== selectedRow)
      .map((row) => row.map((cell) => ({ ...cell })));
    commit({ rows: value.rows - 1, cols: value.cols, cells: newCells });
    const newSelectedRow = Math.min(selectedRow, value.rows - 2);
    setSelectedCells(new Set([`${newSelectedRow}-${selectedCol}`]));
  }, [selectedRow, selectedCol, value, commit]);

  const handleInsertColLeft = useCallback(() => {
    if (selectedCol < 0 || value.cols >= 10) return;

    const newCells: TableCell[][] = value.cells.map((row) => {
      const newRow: TableCell[] = [];
      for (let c = 0; c <= value.cols; c++) {
        if (c < selectedCol) {
          newRow[c] = row[c] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else if (c === selectedCol) {
          // New empty column — 默认居中
          newRow[c] = { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else {
          newRow[c] = row[c - 1] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        }
      }
      return newRow;
    });
    commit({ rows: value.rows, cols: value.cols + 1, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${selectedCol}`]));
  }, [selectedCol, value, commit, selectedRow]);

  const handleInsertColRight = useCallback(() => {
    if (selectedCol < 0 || value.cols >= 10) return;

    const insertIndex = selectedCol + 1;
    const newCells: TableCell[][] = value.cells.map((row) => {
      const newRow: TableCell[] = [];
      for (let c = 0; c <= value.cols; c++) {
        if (c < insertIndex) {
          newRow[c] = row[c] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else if (c === insertIndex) {
          // New empty column — 默认居中
          newRow[c] = { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        } else {
          newRow[c] = row[c - 1] || { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
        }
      }
      return newRow;
    });
    commit({ rows: value.rows, cols: value.cols + 1, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${insertIndex}`]));
  }, [selectedCol, value, commit, selectedRow]);

  const handleDeleteCol = useCallback(() => {
    if (selectedCol < 0 || value.cols <= 1) return;

    const newCells: TableCell[][] = value.cells.map((row) =>
      row.filter((_, c) => c !== selectedCol).map((cell) => ({ ...cell }))
    );
    const newSelectedCol = Math.min(selectedCol, value.cols - 2);
    commit({ rows: value.rows, cols: value.cols - 1, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${newSelectedCol}`]));
  }, [selectedCol, selectedRow, value, commit]);

  return (
    <div className="grid gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.3)] px-3 py-2">
        {/* Left: Undo + Alignment buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoState.history.length === 0}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="撤回上一步表格操作"
          >
            <Undo2 size={14} />
            撤回
          </button>
          <div className="mx-1 h-4 w-px bg-[rgba(200,210,230,0.5)]" />
          <button
            type="button"
            onClick={() => handleCellAlign("left")}
            disabled={selectedCells.size === 0}
            className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="左对齐"
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleCellAlign("center")}
            disabled={selectedCells.size === 0}
            className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="居中"
          >
            <AlignCenter size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleCellAlign("right")}
            disabled={selectedCells.size === 0}
            className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="右对齐"
          >
            <AlignRight size={14} />
          </button>
        </div>

        {/* Center: Merge/Split buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleMergeCells}
            disabled={!canMerge}
            className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="合并单元格"
          >
            <Merge size={14} />
          </button>
          <button
            type="button"
            onClick={handleSplitCells}
            disabled={!canSplit}
            className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="拆分单元格"
          >
            <Split size={14} />
          </button>
        </div>

        {/* Row/Column insert/delete buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleInsertRowAbove}
            disabled={!canInsertRow}
            className="flex flex-col items-center rounded-lg p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="在上方插入行"
          >
            <Plus size={10} />
            <ArrowDown size={10} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={handleInsertRowBelow}
            disabled={!canInsertRow}
            className="flex flex-col items-center rounded-lg p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="在下方插入行"
          >
            <Plus size={10} />
            <ArrowDown size={10} />
          </button>
          <button
            type="button"
            onClick={handleDeleteRow}
            disabled={!canDeleteRow}
            className="flex flex-col items-center rounded-lg p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="删除行"
          >
            <Minus size={10} />
            <ArrowDown size={10} />
          </button>
          <div className="mx-1 h-4 w-px bg-[rgba(200,210,230,0.5)]" />
          <button
            type="button"
            onClick={handleInsertColLeft}
            disabled={!canInsertCol}
            className="flex flex-row items-center rounded-lg p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="在左侧插入列"
          >
            <Plus size={10} />
            <ArrowRight size={10} className="rotate-180" />
          </button>
          <button
            type="button"
            onClick={handleInsertColRight}
            disabled={!canInsertCol}
            className="flex flex-row items-center rounded-lg p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="在右侧插入列"
          >
            <Plus size={10} />
            <ArrowRight size={10} />
          </button>
          <button
            type="button"
            onClick={handleDeleteCol}
            disabled={!canDeleteCol}
            className="flex flex-row items-center rounded-lg p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)] disabled:opacity-40"
            title="删除列"
          >
            <Minus size={10} />
            <ArrowRight size={10} />
          </button>
        </div>

        {/* Right: Row/Column controls */}
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-[color:var(--muted-foreground)]">行数</span>
            <input
              type="number"
              min={1}
              max={20}
              value={value.rows}
              onChange={(e) => {
                const rows = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
                const newCells: TableCell[][] = [];
                for (let r = 0; r < rows; r++) {
                  newCells[r] = [];
                  for (let c = 0; c < value.cols; c++) {
                    newCells[r][c] = value.cells[r]?.[c] || {
                      content: "",
                      rowSpan: 1,
                      colSpan: 1,
                      align: "center" as const,
                    };
                  }
                }
                commit({ ...value, rows, cells: newCells });
              }}
              className="w-14 rounded-[8px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-1.5 py-0.5 text-center text-sm outline-none focus:border-[rgba(107,149,240,0.34)]"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[color:var(--muted-foreground)]">列数</span>
            <input
              type="number"
              min={1}
              max={10}
              value={value.cols}
              onChange={(e) => {
                const cols = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                const newCells: TableCell[][] = value.cells.map((row) => {
                  const newRow = [...row];
                  for (let c = newRow.length; c < cols; c++) {
                    newRow[c] = { content: "", rowSpan: 1, colSpan: 1, align: "center" as const };
                  }
                  return newRow.slice(0, cols);
                });
                commit({ ...value, cols, cells: newCells });
              }}
              className="w-14 rounded-[8px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] px-1.5 py-0.5 text-center text-sm outline-none focus:border-[rgba(107,149,240,0.34)]"
            />
          </label>
        </div>
      </div>

      {/* Table */}
      <div
        className="overflow-auto rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] p-3"
        onPaste={handlePaste}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <table
          ref={tableRef}
          className="w-full border-collapse"
          style={{ tableLayout: "fixed" }}
        >
          <tbody>
            {Array.from({ length: value.rows }).map((_, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: value.cols }).map((_, colIndex) => {
                  const cell = value.cells[rowIndex]?.[colIndex];
                  if (!cell || cell.hidden) return null;

                  return (
                    <td
                      key={colIndex}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className={`border border-[rgba(200,210,230,0.6)] p-0 ${
                        selectedCells.has(`${rowIndex}-${colIndex}`) ? "bg-[rgba(96,139,239,0.15)]" : ""
                      }`}
                      style={{ textAlign: cell.align }}
                      onMouseDown={(e) => handleCellMouseDown(rowIndex, colIndex, e)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                    >
                      <input
                        type="text"
                        value={cell.content}
                        onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                        onFocus={() => {
                          setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
                        }}
                        placeholder={rowIndex === 0 ? '' : '点击输入'}
                        className="w-full border-none bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-[rgba(96,139,239,0.12)] focus:ring-2 focus:ring-[rgba(96,139,239,0.25)] focus:ring-inset rounded"
                        style={{ textAlign: cell.align }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
        提示：按住鼠标左键拖动可选择多个单元格，点击工具栏「合并」即可合并；点击已合并的单元格后点「拆分」可还原。Ctrl/⌘+点击加减选区，Shift+点击扩展选区。误操作可点「撤回」逐步恢复。
      </p>
    </div>
  );
}
