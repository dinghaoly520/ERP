/**
 * 公司名相似度排序（2026-11-10 专家导入归属指定面板）：表格「工作单位」未命中两档
 * 精确解析时，按名字相近度为该行下拉排候选——最可能的一家置顶（用户裁定）。
 * 纯前端字符串启发式：剥通用前后缀 → 包含/最长公共子串比例打分，不猜语义。
 */

/** 通用后缀：有限公司主体形态（长在前防短截断） */
const GENERIC_SUFFIXES = ['有限责任公司', '股份有限公司', '有限公司', '集团公司', '集团', '公司'];
/** 通用前缀：行政区划（四川省/四川——名单全部为省内企业，前缀区分度低） */
const GENERIC_PREFIXES = ['四川省', '四川'];

/** 归一化：剥通用前后缀 + 去空白（引大例：引大济岷水资源开发有限公司 → 引大济岷水资源开发） */
export function normalizeCompanyName(name: string): string {
  let n = name.replace(/\s+/g, '');
  for (const p of GENERIC_PREFIXES) {
    if (n.startsWith(p) && n.length - p.length >= 4) { n = n.slice(p.length); break; }
  }
  for (const s of GENERIC_SUFFIXES) {
    if (n.endsWith(s) && n.length - s.length >= 4) { n = n.slice(0, -s.length); break; }
  }
  return n;
}

/** 最长公共子串长度（O(n·m) 动态规划；公司名 ≤30 字，量级可忽略） */
function longestCommonSubstring(a: string, b: string): number {
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/** 相似度 0~1：归一后全等 > 互含 > 公共子串占比 */
export function companyNameSimilarity(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  return (longestCommonSubstring(na, nb) / Math.max(na.length, nb.length)) * 0.8;
}

/** 候选排序：按相似度降序；零分（无任何公共子串）沉底，稳定保持原有相对顺序 */
export function rankCompaniesBySimilarity<T extends { name: string }>(
  sheetName: string,
  candidates: readonly T[],
): Array<T & { similarity: number }> {
  return candidates
    .map((c) => ({ ...c, similarity: companyNameSimilarity(sheetName, c.name) }))
    .sort((x, y) => y.similarity - x.similarity || 0);
}
