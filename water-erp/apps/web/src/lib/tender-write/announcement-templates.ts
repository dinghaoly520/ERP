import {
  ANNOUNCEMENT_AVAILABILITY,
} from "@/lib/types/announcement";
import type {
  AnnouncementCategory,
  AnnouncementFieldConfig,
  AnnouncementFieldKey,
  InvitedBiddingAnnouncementDraft,
  InternalBiddingAnnouncementDraft,
  SingleSourceAnnouncementDraft,
  FailedBidAnnouncementDraft,
  WinningBidAnnouncementDraft,
  AnnouncementDraft,
} from "@/lib/types/announcement";
import { TENDER_DOCUMENT_TYPES } from "./templates";
import type { TenderDocumentType } from "@/lib/types/tender-write";

/** 公告类型与采购文件类型的匹配关系 */
export function getAvailableAnnouncementCategories(
  tenderType: TenderDocumentType | null,
): AnnouncementCategory[] {
  if (!tenderType) return [];
  return ANNOUNCEMENT_AVAILABILITY[tenderType] ?? [];
}

/** 根据采购文件类型获取对应的公告标签 */
export function getAnnouncementLabel(
  tenderType: TenderDocumentType,
  category: AnnouncementCategory,
): string {
  const tenderMeta = TENDER_DOCUMENT_TYPES.find((t) => t.type === tenderType);
  const tenderLabel = tenderMeta?.label ?? "";

  if (category === "procurement_document") {
    if (tenderType === "INVITED_BIDDING") return "邀请招标公告";
    if (tenderType === "INTERNAL_BIDDING") return "内部竞标（竞价）公告";
    if (tenderType === "SINGLE_SOURCE") return "单源直接采购公告";
  }
  if (category === "failed_bid") return "流标公告";
  if (category === "winning_bid") return "中标公告";

  return `${tenderLabel}公告`;
}

// ─── 邀请招标公告 / 内部竞标公告 字段配置 ───

export const INVITED_OR_INTERNAL_BIDDING_ANNOUNCEMENT_FIELDS: AnnouncementFieldConfig[] = [
  {
    key: "projectName",
    label: "项目名称",
    placeholder: "请输入项目名称",
    autoFill: "projectName",
  },
  {
    key: "projectOverview",
    label: "项目概况和采购内容",
    placeholder: "请输入项目概况和采购内容",
    multiline: true,
    autoFill: "projectOverview",
    aiPrompt: "根据项目名称和招标文件中的项目信息，生成公告中的项目概况和采购内容。要求简洁概括项目背景、目标和采购范围。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "maxPriceNumeric",
    label: "最高限价（小写）",
    placeholder: "例如 350000",
    autoFill: "maxPrice",
  },
  {
    key: "scheduleRequirementsType",
    label: "工期及进度要求",
    placeholder: "",
    select: {
      options: [
        { value: "none", label: "无" },
        { value: "have", label: "有" },
      ],
    },
  },
  {
    key: "scheduleRequirements",
    label: "工期及进度要求内容",
    placeholder: "请输入工期及进度要求",
    multiline: true,
    aiPrompt: "根据招标文件中的项目信息和商务要求，生成工期及进度要求。包含工期天数/日历天、里程碑节点、进度计划要求等。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "registrationMethod",
    label: "报名方式及条件",
    placeholder: "请输入报名方式及条件",
    multiline: true,
    aiPrompt: "根据招标文件中的供应商资格要求和采购内容，生成公告中的报名方式及条件。包含报名时间、报名方式（邮件/现场/网上）、所需材料、资格条件等。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "announcementStart",
    label: "公示期限（起）",
    placeholder: "选择日期",
    type: "date",
  },
  {
    key: "announcementEnd",
    label: "公示期限（止）",
    placeholder: "选择日期",
    type: "date",
  },
  {
    key: "bidOpeningTime",
    label: "开标时间",
    placeholder: "另行通知",
    composite: {
      typeKey: "bidOpeningTimeType",
      typeLabel: "时间类型",
      typeOptions: [
        { value: "datetime", label: "选择时间" },
        { value: "text", label: "填入文字" },
      ],
    },
  },
  {
    key: "contactName",
    label: "联系人",
    placeholder: "请输入联系人",
    autoFill: "contactName",
  },
  {
    key: "contactPhone",
    label: "联系电话",
    placeholder: "请输入联系电话",
    type: "tel",
    autoFill: "contactPhone",
  },
  {
    key: "contactEmail",
    label: "联系邮箱",
    placeholder: "请输入联系邮箱",
    type: "email",
    autoFill: "contactEmail",
  },
  {
    key: "signatureDate",
    label: "落款日期",
    placeholder: "选择日期",
    type: "date",
  },
];

// ─── 单源直接采购公告 字段配置 ───

export const SINGLE_SOURCE_ANNOUNCEMENT_FIELDS: AnnouncementFieldConfig[] = [
  {
    key: "projectName",
    label: "项目名称",
    placeholder: "请输入项目名称",
    autoFill: "projectName",
  },
  {
    key: "projectOverview",
    label: "项目概况和采购内容",
    placeholder: "请输入项目概况和采购内容",
    multiline: true,
    autoFill: "projectOverview",
    aiPrompt: "根据项目名称和招标文件中的项目信息，生成单源直接采购公告中的项目概况和采购内容。要求简洁概括项目背景、目标、采购范围和采购内容。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "maxPriceNumeric",
    label: "预算金额（小写）",
    placeholder: "例如 680000",
    autoFill: "maxPrice",
  },
  {
    key: "argumentOpinion",
    label: "论证意见",
    placeholder: "请输入论证意见",
    multiline: true,
    aiPrompt: "根据项目名称、采购内容和拟定供应商信息，生成单一来源采购的论证意见。说明为什么只能从该供应商采购，包含技术唯一性、专利专有性、延续性等论证理由。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "supplierName",
    label: "拟定供应商名称",
    placeholder: "请输入供应商名称",
    autoFill: "supplierName",
  },
  {
    key: "supplierAddress",
    label: "拟定供应商地址",
    placeholder: "请输入供应商地址",
    multiline: true,
    aiPrompt: "根据拟定供应商名称，生成供应商的详细地址信息。格式为：省+市+区+详细地址。只输出地址，不要其他说明。",
  },
  {
    key: "announcementStart",
    label: "公示期限（起）",
    placeholder: "选择日期",
    type: "date",
  },
  {
    key: "announcementEnd",
    label: "公示期限（止）",
    placeholder: "选择日期",
    type: "date",
  },
  {
    key: "announcementDays",
    label: "公示期限（天数）",
    placeholder: "例如 5",
  },
  {
    key: "procurementTime",
    label: "采购时间",
    placeholder: "选择日期",
    type: "date",
  },
  {
    key: "signatureDate",
    label: "落款日期",
    placeholder: "选择日期",
    type: "date",
  },
];

// ─── 流标公告 字段配置 ───

export const FAILED_BID_ANNOUNCEMENT_FIELDS: AnnouncementFieldConfig[] = [
  {
    key: "projectName",
    label: "项目名称",
    placeholder: "请输入项目名称",
    autoFill: "projectName",
  },
  {
    key: "projectBriefDescription",
    label: "项目简要说明",
    placeholder: "请输入项目简要说明",
    multiline: true,
    aiPrompt: "根据招标文件中的项目名称、项目概况和采购内容，生成流标公告中的项目简要说明。要求用1-3句话概括项目基本信息和采购范围。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "bidOpeningTime",
    label: "开标时间",
    placeholder: "另行通知",
    composite: {
      typeKey: "bidOpeningTimeType",
      typeLabel: "时间类型",
      typeOptions: [
        { value: "datetime", label: "选择时间" },
        { value: "text", label: "填入文字" },
      ],
    },
  },
  {
    key: "resultInfo",
    label: "开标结果公示信息",
    placeholder: "请输入开标结果公示信息",
    multiline: true,
    aiPrompt: "根据项目信息生成流标公告中的开标结果公示信息。说明流标原因，如：有效投标不足法定家数、所有投标超过最高限价、投标人资格不符等。要求简明扼要。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "signatureDate",
    label: "落款日期",
    placeholder: "选择日期",
    type: "date",
  },
];

// ─── 中标公告 字段配置 ───

export const WINNING_BID_ANNOUNCEMENT_FIELDS: AnnouncementFieldConfig[] = [
  {
    key: "projectName",
    label: "项目名称",
    placeholder: "请输入项目名称",
    autoFill: "projectName",
  },
  {
    key: "projectBriefDescription",
    label: "项目简要说明",
    placeholder: "请输入项目简要说明",
    multiline: true,
    aiPrompt: "根据招标文件中的项目名称、项目概况和采购内容，生成中标公告中的项目简要说明。要求用1-3句话概括项目基本信息和采购范围。不要使用#、*等符号，不要出现空行。",
  },
  {
    key: "maxPrice",
    label: "最高限价（小写）",
    placeholder: "例如 350000",
    autoFill: "maxPrice",
  },
  {
    key: "bidOpeningTime",
    label: "开标时间",
    placeholder: "另行通知",
    composite: {
      typeKey: "bidOpeningTimeType",
      typeLabel: "时间类型",
      typeOptions: [
        { value: "datetime", label: "选择时间" },
        { value: "text", label: "填入文字" },
      ],
    },
  },
  // Bidder fields are handled dynamically — see BidderEditor in announcement-dialog
  {
    key: "bidder1RemarkType",
    label: "备注",
    placeholder: "",
    select: {
      options: [
        { value: "最低价中标", label: "最低价中标" },
        { value: "综合评分中标", label: "综合评分中标" },
        { value: "手动填入", label: "手动填入" },
      ],
    },
  },
  {
    key: "bidder1Remark",
    label: "备注内容",
    placeholder: "请输入备注内容",
  },
  {
    key: "signatureDate",
    label: "落款日期",
    placeholder: "选择日期",
    type: "date",
  },
];

// ─── 获取字段配置 ───

export function getAnnouncementFields(
  tenderType: TenderDocumentType,
  category: AnnouncementCategory,
): AnnouncementFieldConfig[] {
  if (category === "procurement_document") {
    if (tenderType === "SINGLE_SOURCE") {
      return SINGLE_SOURCE_ANNOUNCEMENT_FIELDS;
    }
    // INVITED_BIDDING and INTERNAL_BIDDING share the same fields
    return INVITED_OR_INTERNAL_BIDDING_ANNOUNCEMENT_FIELDS;
  }
  if (category === "failed_bid") {
    return FAILED_BID_ANNOUNCEMENT_FIELDS;
  }
  if (category === "winning_bid") {
    return WINNING_BID_ANNOUNCEMENT_FIELDS;
  }
  return [];
}

// ─── 创建空草稿 ───

export function createEmptyInvitedBiddingAnnouncementDraft(): InvitedBiddingAnnouncementDraft {
  return {
    projectName: "",
    projectOverview: "",
    maxPriceChinese: "",
    maxPriceNumeric: "",
    scheduleRequirements: "",
    scheduleRequirementsType: "",
    registrationMethod: "",
    announcementStart: "",
    announcementEnd: "",
    bidOpeningTime: "",
    bidOpeningTimeType: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    signatureDate: "",
  };
}

export function createEmptyInternalBiddingAnnouncementDraft(): InternalBiddingAnnouncementDraft {
  return createEmptyInvitedBiddingAnnouncementDraft();
}

export function createEmptySingleSourceAnnouncementDraft(): SingleSourceAnnouncementDraft {
  return {
    projectName: "",
    projectOverview: "",
    maxPriceChinese: "",
    maxPriceNumeric: "",
    argumentOpinion: "",
    supplierName: "",
    supplierAddress: "",
    announcementStart: "",
    announcementEnd: "",
    announcementDays: "",
    procurementTime: "",
    signatureDate: "",
  };
}

export function createEmptyFailedBidAnnouncementDraft(): FailedBidAnnouncementDraft {
  return {
    projectName: "",
    projectBriefDescription: "",
    bidOpeningTime: "",
    bidOpeningTimeType: "",
    resultInfo: "",
    signatureDate: "",
  };
}

export function createEmptyWinningBidAnnouncementDraft(): WinningBidAnnouncementDraft {
  return {
    projectName: "",
    projectBriefDescription: "",
    maxPrice: "",
    maxPriceChinese: "",
    bidOpeningTime: "",
    bidOpeningTimeType: "",
    bidder1Name: "",
    bidder1Price: "",
    bidder1Remark: "",
    bidder1RemarkType: "",
    bidder2Name: "",
    bidder2Price: "",
    bidder3Name: "",
    bidder3Price: "",
    signatureDate: "",
  };
}

export function createEmptyAnnouncementDraft(
  tenderType: TenderDocumentType,
  category: AnnouncementCategory,
): AnnouncementDraft {
  if (category === "procurement_document") {
    if (tenderType === "SINGLE_SOURCE") {
      return createEmptySingleSourceAnnouncementDraft();
    }
    return createEmptyInvitedBiddingAnnouncementDraft();
  }
  if (category === "failed_bid") {
    return createEmptyFailedBidAnnouncementDraft();
  }
  if (category === "winning_bid") {
    return createEmptyWinningBidAnnouncementDraft();
  }
  return createEmptyFailedBidAnnouncementDraft();
}

// ─── 自动填充映射 ───

/**
 * Auto-fill mapping: announcement field keys -> tender draft field keys.
 * When the announcement dialog opens, matching tender draft values are copied.
 */
export const ANNOUNCEMENT_AUTO_FILL: Record<string, string> = {
  projectName: "projectName",
  projectOverview: "projectOverview",
  maxPriceNumeric: "maxPrice",
  maxPrice: "maxPrice",
  contactName: "contactName",
  contactPhone: "contactPhone",
  contactEmail: "contactEmail",
  supplierName: "supplierName",
};

/**
 * Apply auto-fill: copy matching fields from tender draft to announcement draft.
 */
export function applyAutoFill(
  draft: AnnouncementDraft,
  tenderDraft: Record<string, string>,
  fields: AnnouncementFieldConfig[],
): AnnouncementDraft {
  const result = { ...draft } as Record<string, string>;

  for (const field of fields) {
    const tenderKey = ANNOUNCEMENT_AUTO_FILL[field.key];
    if (tenderKey && tenderDraft[tenderKey]?.trim()) {
      // Only auto-fill if the announcement field is empty
      if (!result[field.key]?.trim()) {
        result[field.key] = tenderDraft[tenderKey];
      }
    }
  }

  // Auto-calculate Chinese uppercase from numeric price if available
  const numericPrice = result.maxPriceNumeric || result.maxPrice || "";
  if (numericPrice.trim() && !result.maxPriceChinese?.trim()) {
    result.maxPriceChinese = numberToChineseAmount(numericPrice);
  }

  return result as AnnouncementDraft;
}

/**
 * Convert numeric amount to Chinese uppercase (e.g. 1111.00 → 壹仟壹佰壹拾壹元)
 * - 小数点后全零则忽略，不读角分
 * - 不加"整"
 */
export function numberToChineseAmount(numStr: string): string {
  const amount = parseFloat(numStr);
  if (isNaN(amount) || amount < 0) return "";
  if (amount === 0) return "零元";

  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const units = ["", "拾", "佰", "仟"];
  const bigUnits = ["", "万", "亿"];

  const parts = numStr.split(".");
  const intStr = parts[0] || "0";
  let result = "";

  const intNum = parseInt(intStr, 10);
  if (intNum > 0) {
    const groups: string[] = [];
    let remaining = intNum;
    while (remaining > 0) {
      groups.push(String(remaining % 10000).padStart(4, "0"));
      remaining = Math.floor(remaining / 10000);
    }

    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const group = groups[gi];
      let groupResult = "";
      let allZero = true;
      for (let i = 0; i < 4; i++) {
        const d = parseInt(group[i], 10);
        if (d !== 0) {
          allZero = false;
          if (groupResult.endsWith("零")) {
            groupResult = groupResult.slice(0, -1);
          }
          groupResult += digits[d] + units[3 - i];
        } else if (!groupResult.endsWith("零") && groupResult.length > 0) {
          groupResult += "零";
        }
      }
      if (groupResult.endsWith("零")) {
        groupResult = groupResult.slice(0, -1);
      }
      if (!allZero) {
        result += groupResult + bigUnits[gi];
      } else if (result.length > 0 && !result.endsWith("零")) {
        result += "零";
      }
    }
    result += "元";
  }

  // Only read decimal part when it has non-zero digits
  if (parts[1]) {
    const jiao = parseInt(parts[1][0] || "0", 10);
    const fen = parseInt(parts[1][1] || "0", 10);
    if (jiao > 0 || fen > 0) {
      if (jiao > 0) result += digits[jiao] + "角";
      else if (intNum > 0) result += "零";
      if (fen > 0) result += digits[fen] + "分";
    }
  }

  return result;
}
