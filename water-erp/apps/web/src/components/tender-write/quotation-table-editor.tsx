"use client";

import { useCallback, useRef, useState } from "react";
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

type QuotationTableEditorProps = {
  value: TableData;
  onChange: (data: TableData) => void;
};

export function QuotationTableEditor({ value, onChange }: QuotationTableEditorProps) {
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ row: number; col: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ row: number; col: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

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

    const minRow = Math.min(...positions.map((p) => p.r));
    const maxRow = Math.max(...positions.map((p) => p.r));
    const minCol = Math.min(...positions.map((p) => p.c));
    const maxCol = Math.max(...positions.map((p) => p.c));

    const rowSpan = maxRow - minRow + 1;
    const colSpan = maxCol - minCol + 1;

    const mergedContent = positions
      .map((p) => value.cells[p.r]?.[p.c]?.content || "")
      .filter(Boolean)
      .join(" ");

    const newCells = value.cells.map((row, r) =>
      row.map((cell, c) => {
        if (r === minRow && c === minCol) {
          return { ...cell, rowSpan, colSpan, content: mergedContent };
        }
        if (r >= minRow && r <= maxRow && c >= minCol && c <= maxCol) {
          return { ...cell, hidden: true };
        }
        return cell;
      })
    );

    onChange({ ...value, cells: newCells });
    setSelectedCells(new Set());
  }, [value, onChange, selectedCells]);

  const handleSplitCells = useCallback(() => {
    if (selectedCells.size !== 1) return;

    const key = Array.from(selectedCells)[0];
    const [rowIndex, colIndex] = key.split("-").map(Number);
    const cell = value.cells[rowIndex]?.[colIndex];

    if (!cell || cell.rowSpan === 1 && cell.colSpan === 1) return;

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
    setSelectedCells(new Set());
  }, [value, onChange, selectedCells]);

  const handleCellMouseDown = useCallback((rowIndex: number, colIndex: number, e: React.MouseEvent) => {
    // Don't prevent default when clicking on input to allow text editing
    const target = e.target as HTMLElement;
    const isInputClick = target.tagName === 'INPUT';

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

    // Shift+click: extend selection from last selected cell
    if (e.shiftKey && selectedCells.size > 0) {
      e.preventDefault();
      // Get the first selected cell as anchor
      const firstKey = Array.from(selectedCells)[0];
      const [anchorRow, anchorCol] = firstKey.split("-").map(Number);
      const minRow = Math.min(anchorRow, rowIndex);
      const maxRow = Math.max(anchorRow, rowIndex);
      const minCol = Math.min(anchorCol, colIndex);
      const maxCol = Math.max(anchorCol, colIndex);

      const newSelection = new Set<string>();
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          newSelection.add(`${r}-${c}`);
        }
      }
      setSelectedCells(newSelection);
      return;
    }

    // If clicking on input, allow normal text editing
    if (isInputClick) {
      return;
    }

    // Start drag selection only when not clicking on input
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ row: rowIndex, col: colIndex });
    setDragEnd({ row: rowIndex, col: colIndex });
    setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
  }, [selectedCells]);

  const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
    if (!isDragging || !dragStart) return;

    setDragEnd({ row: rowIndex, col: colIndex });

    // Update selection to cover from start to current
    const minRow = Math.min(dragStart.row, rowIndex);
    const maxRow = Math.max(dragStart.row, rowIndex);
    const minCol = Math.min(dragStart.col, colIndex);
    const maxCol = Math.max(dragStart.col, colIndex);

    const newSelection = new Set<string>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        newSelection.add(`${r}-${c}`);
      }
    }
    setSelectedCells(newSelection);
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
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

  const canMerge = selectedCells.size > 1;
  const canSplit = selectedCells.size === 1 && (() => {
    const key = Array.from(selectedCells)[0];
    const [r, c] = key.split("-").map(Number);
    const cell = value.cells[r]?.[c];
    return cell && (cell.rowSpan > 1 || cell.colSpan > 1);
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
          newCells[r][c] = value.cells[r]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else if (r === selectedRow) {
          // New empty row
          newCells[r][c] = { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else {
          newCells[r][c] = value.cells[r - 1]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
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
          newCells[r][c] = value.cells[r]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else if (r === insertIndex) {
          // New empty row
          newCells[r][c] = { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else {
          newCells[r][c] = value.cells[r - 1]?.[c] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
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
          newRow[c] = row[c] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else if (c === selectedCol) {
          // New empty column
          newRow[c] = { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else {
          newRow[c] = row[c - 1] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
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
          newRow[c] = row[c] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else if (c === insertIndex) {
          // New empty column
          newRow[c] = { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
        } else {
          newRow[c] = row[c - 1] || { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
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
                      align: "left" as const,
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
                    newRow[c] = { content: "", rowSpan: 1, colSpan: 1, align: "left" as const };
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
                          // Select the cell when input is focused
                          setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
                        }}
                        className={`w-full border-none bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-[rgba(96,139,239,0.08)]`}
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
    </div>
  );
}
