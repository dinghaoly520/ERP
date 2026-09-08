import { parseAmountToYuan } from "@water-erp/shared";

/**
 * A-113：供应商端唱标字段动态渲染辅助。
 * 后端权威源 = apps/api/src/bid/opening-field-config.util.ts（DEFAULT_OPENING_FIELDS /
 * resolveOpeningFieldConfig），本文件是其供应商端渲染镜像（两端同步改；:3007 主持端镜像
 * 见 apps/bid-portal/src/components/opening-hall.tsx FALLBACK_FIELDS——同一先例）。
 * 供应商端差异：法定四列沿用本页历史标签/列宽（报价——P1-C 去单位后缀，值自带单位 /质量目标——与 :3007 措辞本就
 * 不同），保「无配置项目与现状渲染一致」的零漂移铁律；config 仅驱动列序与动态列。
 */

/** 唱标字段定义——后端 OpeningFieldDef 前端镜像 */
export interface OpeningFieldDef {
  /** 唯一键；amount/period/qualityTarget/bondStatus 为法定键（不可删、type 固定） */
  key: string;
  /** 列/表单标签 */
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  required?: boolean;
  prefillFrom?: string;
}

/** 法定四键（与后端 STATUTORY_OPENING_KEYS 镜像） */
const STATUTORY_KEYS = ["amount", "period", "qualityTarget", "bondStatus"] as const;
type StatutoryKey = (typeof STATUTORY_KEYS)[number];
export const isStatutoryKey = (key: string): key is StatutoryKey =>
  (STATUTORY_KEYS as readonly string[]).includes(key);

/** 法定四列本页固定口径：标签 + 列宽类（历史措辞，默认态零漂移的契约来源） */
export const STATUTORY_COLUMNS: Record<StatutoryKey, { label: string; width: string }> = {
  amount: { label: "报价", width: "w-amount" },
  period: { label: "工期", width: "w-period" },
  qualityTarget: { label: "质量目标", width: "w-quality" },
  bondStatus: { label: "保证金", width: "w-bond" },
};

/** 列头标签：法定键用本页历史标签，动态键用 config 标签 */
export function openingColumnLabel(f: OpeningFieldDef): string {
  return isStatutoryKey(f.key) ? STATUTORY_COLUMNS[f.key].label : f.label;
}

/** 列宽类：法定键沿用既有 w-* 类，动态列自适应（undefined） */
export function openingColumnWidth(f: OpeningFieldDef): string | undefined {
  return isStatutoryKey(f.key) ? STATUTORY_COLUMNS[f.key].width : undefined;
}

/**
 * 默认四字段兜底——后端 DEFAULT_OPENING_FIELDS 的渲染镜像（后端为权威源，两端同步改）。
 * 供应商端只读渲染仅消费 key/序（标签走 STATUTORY_COLUMNS），故省略 options/prefillFrom。
 * fieldConfig 缺失（开标前列表端点 400 置空 / 历史响应未带）时兜底 = 现状四列。
 */
export const FALLBACK_FIELDS: readonly OpeningFieldDef[] = [
  { key: "amount", label: "报价", type: "text" },
  { key: "period", label: "工期", type: "text" },
  { key: "qualityTarget", label: "质量承诺", type: "text" },
  { key: "bondStatus", label: "保证金", type: "select" },
];

/** 字段序解析（与后端 resolveOpeningFieldConfig 同语义）：非空字段数组 → 用之，否则兜底四列。 */
export function resolveOpeningFields(fields: OpeningFieldDef[] | null | undefined): OpeningFieldDef[] {
  return fields && fields.length > 0 ? [...fields] : [...FALLBACK_FIELDS];
}

/**
 * 公开总表单元格取值：法定四键走专属列原值（空值维持现状渲染为空，不做 '—' 兜底）；
 * 动态键取 customFields（空显 '—'，与 :3007 记录表口径一致）。
 * row 为结构化宽型（OpeningRecordRow / 本司记录 any 均可传入）。
 */
export function openingRecordCell(
  f: OpeningFieldDef,
  row:
    | {
        amount?: unknown;
        period?: unknown;
        qualityTarget?: unknown;
        bondStatus?: unknown;
        customFields?: Record<string, string> | null;
      }
    | null
    | undefined,
): string | null {
  if (isStatutoryKey(f.key)) return ((row?.[f.key] as string | null | undefined) ?? null);
  return row?.customFields?.[f.key] || "—";
}

/** 本司对比区动态唱标字段增显行（A-113）：仅取 config 动态键且有值者（无法定密封源，只展示不比对） */
export function otherOpeningRows(
  fields: readonly OpeningFieldDef[],
  record: { customFields?: Record<string, string> | null } | null | undefined,
): Array<{ key: string; label: string; value: string }> {
  const custom = record?.customFields;
  if (!custom) return [];
  return fields
    .filter((f) => !isStatutoryKey(f.key) && custom[f.key])
    .map((f) => ({ key: f.key, label: f.label, value: String(custom[f.key]) }));
}

/**
 * P1-1（UI审计）：开标记录金额展示归一——裸数字（含千分位/小数）归一为「千分位 + 元」。
 * BidOpeningRecord.amount 为主持人自由文本：parseAmountToYuan 对「万元」形态亦可解析出元值，
 * 但该形态已自带单位（归一即「10,800,000 元」改写主持人原话），连同不可解析自由文本
 * （如「面议」）一律原文直出——杜绝本司区「1080万元 元」双单位拼接。
 */
export function formatOpeningAmount(raw: string | null | undefined): string {
  const s = raw?.trim();
  if (!s) return "—";
  const yuan = parseAmountToYuan(s);
  if (yuan == null || s.includes("万")) return s;
  return `${yuan.toLocaleString("zh-CN")} 元`;
}

/** P1-C（二轮 UI 审查）：投递报价显示文本。bidPriceInYuan（后端已折算的元数字）→千分位+元；
    仅有自由文本 bidPrice（如「1080万元」/「1485000」）→ 走 formatOpeningAmount 同口径（原文直出或归一）。 */
export function formatBidSubmissionPrice(
  raw: string | null | undefined,
  yuan: number | null | undefined,
): string {
  if (yuan != null && Number.isFinite(yuan)) return `${yuan.toLocaleString("zh-CN")} 元`;
  return formatOpeningAmount(raw ?? null);
}
