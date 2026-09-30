/** 聚合字段变更值摘要化（B4-2，2026-09-30）：bankAccounts/performances/tags/convertToRegular
 *  的新值是整段 JSON——原样渲染压缩 JSON 串，供应商读不懂自己提交了什么。
 *  profile 变更记录弹窗与 /change-records 独立页共用。 */
export function summarizeChangeValue(fieldName: string | undefined, raw: string | null | undefined): string {
  if (!raw) return "—";
  const F = fieldName ?? "";
  if (["bankAccounts", "performances", "tags", "convertToRegular"].includes(F)) {
    try {
      const v = JSON.parse(raw);
      if (F === "bankAccounts") return Array.isArray(v) ? `${v.length} 个银行账户（整体更新）` : String(raw);
      if (F === "performances") {
        if (!Array.isArray(v)) return String(raw);
        return v.length === 0 ? "清空业绩" : `${v.length} 项主体业绩（整体更新，含证明材料 ${v.reduce((n: number, x: any) => n + (Array.isArray(x.proofFiles) ? x.proofFiles.length : 0), 0)} 份）`;
      }
      if (F === "tags") return Array.isArray(v) ? v.join("、") || "（空）" : String(raw);
      if (F === "convertToRegular") {
        const quals = Array.isArray(v?.qualifications) ? v.qualifications.length : 0;
        return `转正资料：联系人 ${Array.isArray(v?.contacts) ? v.contacts.length : 0} 人 · 资质 ${quals} 项`;
      }
    } catch { return String(raw); }
  }
  return String(raw);
}
