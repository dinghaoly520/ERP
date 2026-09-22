/* 本企业证书 DN 匹配 —— 与后端 bindCert 的 DN↔企业名校验同口径（2026-08-31 口径，
 * 原先内联在 profile/ukey 页，CA自检弹窗需要同口径默认选证，抽出共享防漂移）。 */

export function extractCn(certDn: string): string {
  return /(?:^|,)\s*cn\s*=\s*([^,]*)/i.exec(certDn || "")?.[1] ?? "";
}

/** DN → 界面展示术语（2026-09-22）：`证书主体：<CN> · 签发机构：<O>`——U盾管理页
 * 原先裸显 RFC4514 串（CN=…,O=…,C=CN）对业务用户是黑话；C=CN 属噪声省略，
 * 无 CN（解析不出）回退原串，调用方用 title 属性保留原始 DN 备查。 */
export function formatCertDn(certDn: string): string {
  const dn = certDn || "";
  const cn = extractCn(dn).trim();
  if (!cn) return dn;
  const o = /(?:^|,)\s*o\s*=\s*([^,]*)/i.exec(dn)?.[1]?.trim() ?? "";
  return o ? `证书主体：${cn} · 签发机构：${o}` : `证书主体：${cn}`;
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
