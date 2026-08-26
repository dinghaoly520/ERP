/**
 * A1（GB/T 43711 B.4）：采购交易国标组合码生成（纯函数）。
 * 结构（B.4.3/B.4.5.3）：
 *  - 项目编码 18 位 = 3 行业交易分类 + 2 行政区划 + 4 平台对接序列 + 6 日期(YYMMDD) + 3 项目序列
 *  - 采购项目编码 21 位 = 18 位项目编码 + 3 采购项目序列
 *  - 标段编码 24 位 = 21 位采购项目编码 + 3 标段序列
 * 平台编码 12 位由国家级公共服务平台赋予——未接入前用 SystemConfig 占位（默认 0000），
 * 拿到正式码后替换重算即可（字段可空、不动业务唯一键）。
 */

export interface GbCodeInput {
  industryCode: string; // 3 位行业交易分类
  regionCode: string; // 2 位行政区划
  platformSeq: string; // 4 位平台对接序列
  date?: Date;
  projectSeq: number; // 3 位项目序列（同平台同日递增）
}

const pad = (v: string | number, n: number) => String(v).padStart(n, '0').slice(-n);

function assertLen(name: string, v: string, n: number) {
  if (!v || v.length !== n || !/^\d+$/.test(v)) {
    throw new Error(`${name} 须为 ${n} 位数字（收到 "${v}"）`);
  }
}

/** B.4.3.2 项目编码（18 位） */
export function buildGbProjectCode(input: GbCodeInput): string {
  assertLen('行业交易分类', input.industryCode, 3);
  assertLen('行政区划', input.regionCode, 2);
  assertLen('平台对接序列', input.platformSeq, 4);
  const d = input.date ?? new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  if (input.projectSeq < 1 || input.projectSeq > 999) throw new Error('项目序列须 1–999');
  return `${input.industryCode}${input.regionCode}${input.platformSeq}${ymd}${pad(input.projectSeq, 3)}`;
}

/** B.4.3.3 采购项目编码（21 位 = 项目编码 + 3 序列） */
export function buildGbProcureCode(projectCode: string, procureSeq: number): string {
  if (projectCode.length !== 18) throw new Error('项目编码须 18 位');
  if (procureSeq < 1 || procureSeq > 999) throw new Error('采购项目序列须 1–999');
  return `${projectCode}${pad(procureSeq, 3)}`;
}

/** B.4.3.4 标段（标包/份额）编码（24 位 = 采购项目编码 + 3 序列；单标段固定 001） */
export function buildGbSectionCode(procureCode: string, sectionSeq = 1): string {
  if (procureCode.length !== 21) throw new Error('采购项目编码须 21 位');
  if (sectionSeq < 1 || sectionSeq > 999) throw new Error('标段序列须 1–999');
  return `${procureCode}${pad(sectionSeq, 3)}`;
}

/** B.4.2 交易主体编码：B+统一社会信用代码；无信用代码 → C+2位分类+平台码+自编码（此处返回 null 由平台赋码规则另行处理） */
export function buildSubjectCode(creditCode?: string | null): string | null {
  if (!creditCode || !/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode)) return null;
  return `B${creditCode}`;
}
