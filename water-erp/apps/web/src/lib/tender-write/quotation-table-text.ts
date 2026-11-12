import type { TableCell, TableData } from "../types/tender-write";

/**
 * 将报价表序列化为 Tab 分隔文本——设计表格模式下点「AI 优化/生成」时作为
 * currentValue 送模型（表头行一并送出，AI 能对齐列结构；提示词要求其输出不写表头行）。
 * 合并格的隐藏位输出空串占位；整行为空的行跳过（默认表 20 行大部分是空行，送全文是噪音）。
 */
export function serializeTableToText(table: TableData): string {
  const lines: string[] = [];
  for (let r = 0; r < table.cells.length; r++) {
    const row = table.cells[r] ?? [];
    const cols: string[] = [];
    for (let c = 0; c < table.cols; c++) {
      const cell = row[c];
      cols.push(cell && !cell.hidden ? cell.content : "");
    }
    if (cols.some((v) => v.trim())) lines.push(cols.join("\t"));
  }
  return lines.join("\n");
}

/** 表格数据行（除表头外）是否有任何内容——设计表格模式下 AI 按钮显示「生成」还是「优化」的判据。 */
export function tableHasDataRows(table: TableData): boolean {
  return table.cells.slice(1).some((row) =>
    row.some((c) => c && !c.hidden && !!c.content.trim())
  );
}

/** 报价表默认表头列名（2026-11-12 自编辑器迁入——storage 归一化/编辑器共用单一来源）。 */
export const QUOTATION_HEADERS = ['名称', '规格型号', '单位', '数量', '单价（元）', '合价（元）'];

/** 创建带默认表头的报价空表。 */
export function createDefaultQuotationTable(): TableData {
  const cells: TableCell[][] = [];
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
