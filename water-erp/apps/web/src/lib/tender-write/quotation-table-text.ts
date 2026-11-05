import type { TableData } from "../types/tender-write";

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
