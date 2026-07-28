"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Merge, Split, Plus, Minus, ArrowDown, ArrowRight } from "lucide-react";

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

/** 报价表默认表头列名。 */
const QUOTATION_HEADERS = ['名称', '规格型号', '单位', '数量', '单价（元）', '合价（元）'];

/** 创建带默认表头的报价空表。 */
export function createDefaultQuotationTable(): TableData {
  const cells: TableCell[][] = [];
  // Header row
  cells[0] = QUOTATION_HEADERS.map((h) => ({
    content: h,
    rowSpan: 1,
    colSpan: 1,
    align: 'center' as const,
  }));
  // 3 empty data rows
  for (let r = 1; r <= 3; r++) {
    cells[r] = [];
    for (let c = 0; c < QUOTATION_HEADERS.length; c++) {
      cells[r][c] = {
        content: '',
        rowSpan: 1,
        colSpan: 1,
        align: c <= 3 ? 'center' : 'right',
      };
    }
  }
  return { rows: cells.length, cols: QUOTATION_HEADERS.length, cells };
}

/** 将 AI 生成的报价文本解析为表格数据（行优先，支持制表符 / 逗号 / 空格分隔）。 */
export function parseQuotationTextToTable(text: string): TableData | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = trimmed.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return null;

  // Detect delimiter: prefer tab, then comma, then whitespace
  let delimiter = '\t';
  const firstLine = lines[0];
  if (firstLine.includes('\t')) {
    delimiter = '\t';
  } else if (firstLine.includes(',')) {
    delimiter = ',';
  } else if (firstLine.includes('；')) {
    delimiter = '；';
  } else {
    // Split by 2+ spaces as a best-effort fallback
    const spaceSplit = firstLine.split(/\s{2,}/).filter(Boolean);
    if (spaceSplit.length >= 2) {
      delimiter = '  '; // not perfect but handles some cases
    } else {
      return null; // can't parse single-column content
    }
  }

  const headerCells = QUOTATION_HEADERS.map((h) => ({
    content: h,
    rowSpan: 1,
    colSpan: 1,
    align: 'center' as const,
  }));

  const dataCells: TableCell[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts =
      delimiter === '  '
        ? lines[i].split(/\s{2,}/).filter(Boolean)
        : lines[i].split(delimiter);
    const row: TableCell[] = [];
    for (let j = 0; j < QUOTATION_HEADERS.length; j++) {
      row.push({
        content: (parts[j] || '').trim(),
        rowSpan: 1,
        colSpan: 1,
        align: j <= 3 ? 'center' : 'right',
      });
    }
    dataCells.push(row);
  }

  return {
    rows: dataCells.length + 1,
    cols: QUOTATION_HEADERS.length,
    cells: [headerCells, ...dataCells],
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
      onChange({ ...value, cells: newCells });
    },
    [value, onChange]
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
      onChange({ ...value, cells: newCells });
    },
    [value, onChange, selectedCells]
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

    onChange({ ...value, cells: newCells });
    // 保留锚点选中，合并后可直接拆分
    setSelectedCells(new Set([`${minR}-${minC}`]));
  }, [value, onChange, selectedCells]);

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

    onChange({ ...value, cells: newCells });
    setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
  }, [value, onChange, selectedCells]);

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
          onChange(parsed);
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
        onChange({ rows: cells.length, cols: maxCols, cells });
      }
    },
    [onChange]
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
    onChange({ rows: value.rows + 1, cols: value.cols, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${selectedCol}`]));
  }, [selectedRow, value, onChange, selectedCol]);

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
    onChange({ rows: value.rows + 1, cols: value.cols, cells: newCells });
    setSelectedCells(new Set([`${insertIndex}-${selectedCol}`]));
  }, [selectedRow, value, onChange, selectedCol]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRow < 0 || value.rows <= 1) return;

    const newCells: TableCell[][] = value.cells
      .filter((_, r) => r !== selectedRow)
      .map((row) => row.map((cell) => ({ ...cell })));
    onChange({ rows: value.rows - 1, cols: value.cols, cells: newCells });
    const newSelectedRow = Math.min(selectedRow, value.rows - 2);
    setSelectedCells(new Set([`${newSelectedRow}-${selectedCol}`]));
  }, [selectedRow, selectedCol, value, onChange]);

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
    onChange({ rows: value.rows, cols: value.cols + 1, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${selectedCol}`]));
  }, [selectedCol, value, onChange, selectedRow]);

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
    onChange({ rows: value.rows, cols: value.cols + 1, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${insertIndex}`]));
  }, [selectedCol, value, onChange, selectedRow]);

  const handleDeleteCol = useCallback(() => {
    if (selectedCol < 0 || value.cols <= 1) return;

    const newCells: TableCell[][] = value.cells.map((row) =>
      row.filter((_, c) => c !== selectedCol).map((cell) => ({ ...cell }))
    );
    const newSelectedCol = Math.min(selectedCol, value.cols - 2);
    onChange({ rows: value.rows, cols: value.cols - 1, cells: newCells });
    setSelectedCells(new Set([`${selectedRow}-${newSelectedCol}`]));
  }, [selectedCol, selectedRow, value, onChange]);

  return (
    <div className="grid gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.3)] px-3 py-2">
        {/* Left: Alignment buttons */}
        <div className="flex items-center gap-1">
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
                onChange({ ...value, rows, cells: newCells });
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
                onChange({ ...value, cols, cells: newCells });
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
        提示：按住鼠标左键拖动可选择多个单元格，点击工具栏「合并」即可合并；点击已合并的单元格后点「拆分」可还原。Ctrl/⌘+点击加减选区，Shift+点击扩展选区。
      </p>
    </div>
  );
}
