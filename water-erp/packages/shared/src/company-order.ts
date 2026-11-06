/* 公司显示顺序 canon（2026-11-06 用户裁定）：集团第一、设计公司第二、其余随后。
   所有公司筛选/选择器选项必须按此排序——后端 /company 列表与各门户筛选共用本工具。
   同 rank 保持调用方原有顺序（稳定排序）。 */

/** 置顶公司（精确名匹配，含简称兜底）——顺序即显示顺序 */
const PINNED_COMPANIES: { names: string[]; rank: number }[] = [
  { names: ['四川省水利发展集团有限公司'], rank: 0 }, // 集团
  { names: ['四川水发勘测设计研究有限公司', '四川水发勘测设计研究院有限公司'], rank: 1 }, // 设计公司（含历史名兜底）
];

/** 公司排序 rank：0=集团 1=设计公司 2=其余 */
export function companyOrderRank(name: string | null | undefined): number {
  if (!name) return 2;
  for (const p of PINNED_COMPANIES) {
    if (p.names.includes(name)) return p.rank;
  }
  return 2;
}

/** 公司名比较器：集团→设计→其余（同 rank 字典序兜底，保证全序稳定） */
export function compareCompanyNames(a: string | null | undefined, b: string | null | undefined): number {
  const ra = companyOrderRank(a);
  const rb = companyOrderRank(b);
  if (ra !== rb) return ra - rb;
  return (a ?? '').localeCompare(b ?? '', 'zh-CN');
}

/** 按公司名排序对象数组（稳定：同 rank+同名的保持原相对顺序由 Array.prototype.sort 稳定性保证） */
export function sortByCompanyName<T>(items: T[], getName: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => compareCompanyNames(getName(a), getName(b)));
}
