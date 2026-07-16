/**
 * 企业登记类型标准化
 *
 * 数据库中的 enterpriseType 字段混合了企业登记类型和资质信息，且同类
 * 型有大量变体（全角/半角括号、自然人/法人/外商投资等修饰语），需标准化到约 10 个主类。
 */

/** 变体映射：命中任一关键词 → 归入主类 */
const VARIANTS: [string[], string][] = [
  // 国有企业须在有限公司/有限责任公司之前——避免"国有其他有限责任公司"被有限公司吞掉
  [['国有企业', '国有经营单位', '国有其他', '全民所有制'], '国有企业'],
  [['个体工商户'], '个体工商户'],
  [['事业单位'], '事业单位'],
  [['集体所有制'], '集体所有制'],
  [['农民专业合作社'], '农民专业合作社'],
  [['股份合作制', '股份合作'], '股份合作企业'],
  [['外商投资企业', '外资企业', '外商独资'], '外商投资企业'],
  [['港澳台法人独资', '台港澳法人独资'], '外商投资企业'],
  [['个人独资企业', '个人独资'], '个人独资企业'],
  [['合伙企业', '普通合伙', '有限合伙', '特殊普通合伙'], '合伙企业'],
  [['私营企业'], '私营企业'],
  // 股份有限公司须在有限公司之前——避免"其他股份有限公司分公司"被有限公司吞掉
  [['股份有限公司'], '股份有限公司'],
  [['有限公司', '有限责任公司'], '有限责任公司'],
  // 通用兜底：无法识别 → 其他
  [['企业单位', '其它', '其他'], '其他'],
];

/** 提取经营范围正文之前的企业登记类型。()内允许嵌套但以 "） " 为界。 */
export function normalizeEnterpriseType(raw: string | undefined | null): string {
  if (!raw) return '其他';

  // 1. 去除资质后缀（"） " 之后的内容）
  let cleaned = raw;
  const spaceIdx = raw.indexOf('） ');
  if (spaceIdx > 0) cleaned = raw.slice(0, spaceIdx + 1);

  // 2. 规范化括号（全角 → 半角）
  const normalized = cleaned
    .replace(/（/g, '(')
    .replace(/）/g, ')');

  // 3. 去掉分公司后缀
  const noBranch = normalized.replace(/分公司(?:\([^)]*\))?$/, '').trim();

  // 4. 去除非上市/上市/自然人投资等修饰语
  const stripped = noBranch
    .replace(/\(非上市[^)]*\)/g, '')
    .replace(/\(上市\)/g, '')
    .replace(/\(自然人投资或控股\)/g, '')
    .replace(/\(非自然人投资或控股的法人独资\)/g, '')
    .replace(/\(法人独资\)/g, '')
    .replace(/\(外商投资企业法人独资\)/g, '')
    .replace(/\(台港澳法人独资\)/g, '')
    .replace(/\(港澳台法人独资\)/g, '')
    .replace(/\(国有控股\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 5. 匹配主类
  for (const [keywords, label] of VARIANTS) {
    for (const kw of keywords) {
      if (stripped.includes(kw)) return label;
    }
  }

  // 6. 兜底
  if (!stripped || stripped === '-' || stripped === '—') return '其他';
  return stripped;
}

/** 简版：仅截断资质后缀，不做类型合并。用于悬停 title 等保留原文场景。 */
export function trimQualifications(raw: string | undefined | null): string {
  if (!raw) return '—';
  const idx = raw.indexOf('） ');
  if (idx > 0) return raw.slice(0, idx + 1);
  return raw;
}
