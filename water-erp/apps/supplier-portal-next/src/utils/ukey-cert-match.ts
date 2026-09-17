/* 本企业证书 DN 匹配 —— 与后端 bindCert 的 DN↔企业名校验同口径（2026-08-31 口径，
 * 原先内联在 profile/ukey 页，CA自检弹窗需要同口径默认选证，抽出共享防漂移）。 */

export function extractCn(certDn: string): string {
  return /(?:^|,)\s*cn\s*=\s*([^,]*)/i.exec(certDn || "")?.[1] ?? "";
}

/** 企业名归一：去空白/括号/间隔点 + 去公司形态后缀 */
function normalizeCompanyName(s: string): string {
  return (s || "").replace(/[\s（）()·]/g, "").replace(/(有限责任公司|股份有限公司|有限公司|集团)/g, "");
}

/** 证书 DN 的 CN 是否归属本企业（归一化后互含） */
export function isOwnCert(certDn: string, companyName: string): boolean {
  if (!companyName) return false;
  return normalizeCompanyName(extractCn(certDn)).includes(normalizeCompanyName(companyName));
}
