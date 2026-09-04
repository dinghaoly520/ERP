/**
 * 系统生成文件统一命名规范（采购文件/采购公告/流标公告/中标通知书/合同/框架协议等）：
 *
 *   {标识编号}-{项目名称}-{文件类型}-{附加标签}-{YYYYMMDD}.{ext}
 *
 * - 标识编号 = 项目编号 / 合同编号 / 协议编号等稳定检索键，置于最前便于排序；
 * - 任一段缺失即整段跳过（不产生连续分隔符）；
 * - 每段清洗文件系统非法字符（反斜杠/斜杠/冒号/通配符/尖括号/竖线与控制字符）并压缩空白，段长上限 60；
 * - 日期统一为生成日 YYYYMMDD（此前各处存在无日期、毫秒时间戳等不一致写法）。
 */

const ILLEGAL_FILENAME_CHARS = '\\/:*?"<>|';
const MAX_PART_LENGTH = 60;

function sanitizePart(part: string): string {
  let s = '';
  for (const ch of part) {
    const code = ch.codePointAt(0) ?? 0;
    s += code < 0x20 || ILLEGAL_FILENAME_CHARS.includes(ch) ? ' ' : ch;
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_PART_LENGTH);
}

export interface StandardFileNameInput {
  /** 标识编号：项目编号 / 合同编号 / 协议编号等 */
  code?: string | null;
  /** 项目名称（或文件主体名称，如供应商名） */
  name?: string | null;
  /** 文件类型（如 询比采购文件 / 采购公告 / 合同草稿） */
  docType: string;
  /** 附加标签：轮次 / 统计期间 / 台账标识等，置于文件类型之后 */
  tag?: string | null;
  /** 生成日期，默认今天 */
  date?: Date;
  /** 扩展名，默认 .docx */
  ext?: string;
}

export function buildStandardFileName(input: StandardFileNameInput): string {
  const date = input.date ?? new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const parts = [input.code, input.name, input.docType, input.tag, dateStr]
    .map((p) => (p != null && String(p).trim() ? sanitizePart(String(p)) : ''))
    .filter(Boolean);
  const ext = input.ext ?? '.docx';
  if (parts.length === 0) return `未命名-${dateStr}${ext}`;
  return `${parts.join('-')}${ext}`;
}
