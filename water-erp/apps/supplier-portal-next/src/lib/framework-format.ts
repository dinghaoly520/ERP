const QUOTA_LABELS: Record<string, string> = {
  quantity: "约定数量",
  totalQuantity: "约定总量",
  annualQuantity: "年度约定数量",
  minQuantity: "最低数量",
  maxQuantity: "最高数量",
  unit: "单位",
  shareRatio: "约定占比",
  ratio: "约定占比",
  percentage: "约定占比",
  minShare: "最低份额",
  maxShare: "最高份额",
  allocation: "分配方式",
  allocationRule: "分配规则",
  regions: "适用区域",
  region: "适用区域",
  allowAdjustment: "允许调整",
  limits: "数量范围",
  note: "补充约定",
};

function labelFor(key: string): string {
  return QUOTA_LABELS[key] ?? "其他约定";
}

function isPercentageKey(key: string): boolean {
  return /(ratio|rate|percentage|percent|share)/i.test(key);
}

function formatNumber(value: number, key: string): string | null {
  if (!Number.isFinite(value)) return null;
  if (isPercentageKey(key)) {
    const percentage = Math.abs(value) <= 1 ? value * 100 : value;
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(percentage)}%`;
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

function formatValue(value: unknown, key: string): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return formatNumber(value, key);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    const parts = value.map((entry) => formatValue(entry, key)).filter((entry): entry is string => Boolean(entry));
    return parts.length ? parts.join("、") : null;
  }
  if (typeof value === "object") {
    const clauses = Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => formatClause(childKey, childValue))
      .filter((entry): entry is string => Boolean(entry));
    return clauses.length ? clauses.join("；") : null;
  }
  return null;
}

function formatClause(key: string, value: unknown): string | null {
  const formatted = formatValue(value, key);
  return formatted ? `${labelFor(key)}：${formatted}` : null;
}

/** 将后端 Json 配额规则转成供应商可理解的条款，避免直接暴露字段名与 JSON 语法。 */
export function formatFrameworkQuotaRule(rule: Record<string, unknown> | null | undefined): string | null {
  if (!rule) return null;
  const clauses = Object.entries(rule)
    .map(([key, value]) => formatClause(key, value))
    .filter((entry): entry is string => Boolean(entry));
  return clauses.length ? clauses.join("；") : null;
}
