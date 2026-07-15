/** 公告类型 */
export type AnnouncementCategory =
  | "procurement_document" // 采购文件公告
  | "failed_bid" // 流标公告
  | "winning_bid"; // 中标公告

export type AnnouncementCategoryMeta = {
  type: AnnouncementCategory;
  label: string;
  description: string;
};

export const ANNOUNCEMENT_CATEGORIES: AnnouncementCategoryMeta[] = [
  {
    type: "procurement_document",
    label: "采购文件公告",
    description: "发布招标项目的采购文件公告，公示项目信息、报名方式、开标安排等。",
  },
  {
    type: "failed_bid",
    label: "流标公告",
    description: "发布项目流标公示，说明流标原因及后续安排。",
  },
  {
    type: "winning_bid",
    label: "中标公告",
    description: "发布项目中标结果公示，公告中标候选人及中标金额。",
  },
];

/** Which announcement categories are available for each tender document type */
export const ANNOUNCEMENT_AVAILABILITY: Record<
  string,
  AnnouncementCategory[]
> = {
  COMPETITIVE_NEGOTIATION: ["failed_bid", "winning_bid"],
  INQUIRY_PURCHASE: ["failed_bid", "winning_bid"],
  INTERNAL_BIDDING: ["procurement_document", "failed_bid", "winning_bid"],
  INVITED_BIDDING: ["procurement_document", "failed_bid", "winning_bid"],
  SINGLE_SOURCE: ["procurement_document", "failed_bid", "winning_bid"],
};

// ─── 采购文件公告 (邀请招标) ───

export type InvitedBiddingAnnouncementFieldKey =
  | "projectName"
  | "projectOverview"
  | "maxPriceChinese"
  | "maxPriceNumeric"
  | "scheduleRequirements"
  | "scheduleRequirementsType"
  | "registrationMethod"
  | "announcementStart"
  | "announcementEnd"
  | "bidOpeningTime"
  | "bidOpeningTimeType"
  | "contactName"
  | "contactPhone"
  | "contactEmail"
  | "signatureDate";

export type InvitedBiddingAnnouncementDraft = Record<
  InvitedBiddingAnnouncementFieldKey,
  string
>;

// ─── 采购文件公告 (竞价采购) ───
// Same field keys as invited bidding
export type InternalBiddingAnnouncementFieldKey =
  InvitedBiddingAnnouncementFieldKey;
export type InternalBiddingAnnouncementDraft =
  InvitedBiddingAnnouncementDraft;

// ─── 采购文件公告 (直接采购) ───

export type SingleSourceAnnouncementFieldKey =
  | "projectName"
  | "projectOverview"
  | "maxPriceChinese"
  | "maxPriceNumeric"
  | "argumentOpinion"
  | "supplierName"
  | "supplierAddress"
  | "announcementStart"
  | "announcementEnd"
  | "announcementDays"
  | "procurementTime"
  | "signatureDate";

export type SingleSourceAnnouncementDraft = Record<
  SingleSourceAnnouncementFieldKey,
  string
>;

// ─── 流标公告 ───

export type FailedBidAnnouncementFieldKey =
  | "projectName"
  | "projectBriefDescription"
  | "bidOpeningTime"
  | "bidOpeningTimeType"
  | "resultInfo"
  | "signatureDate";

export type FailedBidAnnouncementDraft = Record<
  FailedBidAnnouncementFieldKey,
  string
>;

// ─── 中标公告 ───

export type WinningBidAnnouncementFieldKey =
  | "projectName"
  | "projectBriefDescription"
  | "maxPrice"
  | "maxPriceChinese"
  | "bidOpeningTime"
  | "bidOpeningTimeType"
  | "bidder1Name"
  | "bidder1Price"
  | "bidder1Remark"
  | "bidder1RemarkType"
  | "bidder2Name"
  | "bidder2Price"
  | "bidder3Name"
  | "bidder3Price"
  | "signatureDate";

export type WinningBidAnnouncementDraft = Record<
  WinningBidAnnouncementFieldKey,
  string
>;

// ─── Unified types ───

export type AnnouncementFieldKey =
  | InvitedBiddingAnnouncementFieldKey
  | SingleSourceAnnouncementFieldKey
  | FailedBidAnnouncementFieldKey
  | WinningBidAnnouncementFieldKey;

export type AnnouncementDraft =
  | InvitedBiddingAnnouncementDraft
  | SingleSourceAnnouncementDraft
  | FailedBidAnnouncementDraft
  | WinningBidAnnouncementDraft;

export type CompositeFieldConfig = {
  /** Key in the draft to store the selected type (e.g. "bidOpeningTimeType") */
  typeKey: string;
  /** Label for the type selector */
  typeLabel: string;
  /** Options for the type selector */
  typeOptions: { value: string; label: string }[];
};

export type AnnouncementFieldConfig<
  K extends AnnouncementFieldKey = AnnouncementFieldKey,
> = {
  key: K;
  label: string;
  placeholder: string;
  multiline?: boolean;
  type?: "text" | "date" | "email" | "tel";
  /** Key in the tender draft to auto-fill from, if any */
  autoFill?: string;
  select?: {
    options: { value: string; label: string }[];
  };
  /** Composite field: renders a type selector + conditional input */
  composite?: CompositeFieldConfig;
  /** AI prompt for content generation */
  aiPrompt?: string;
};
