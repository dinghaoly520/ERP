export type NotificationGroup = "todo" | "project" | "approval" | "contract" | "system";
export type NotificationTone = "success" | "danger" | "warning" | "info" | "accent" | "neutral";

export interface NotificationMeta {
  label: string;
  group: NotificationGroup;
  tone: NotificationTone;
  actionable?: boolean;
  actionLabel?: string;
}

const META: Record<string, NotificationMeta> = {
  AWARD_LETTER: { label: "成交通知书", group: "todo", tone: "success", actionable: true, actionLabel: "查看并签收" },
  BID_ROUND_OPEN: { label: "报价轮次", group: "todo", tone: "warning", actionable: true, actionLabel: "立即报价" },
  BID_NUDGE_SUPPLIER: { label: "投标提醒", group: "project", tone: "warning", actionable: true, actionLabel: "查看项目" },
  BID_DEADLINE_NUDGE: { label: "截止提醒", group: "project", tone: "danger", actionable: true, actionLabel: "查看项目" },
  QUALIFICATION_EXPIRING: { label: "资质到期", group: "approval", tone: "warning", actionable: true, actionLabel: "更新资质" },
  CLARIFICATION: { label: "澄清文件", group: "project", tone: "info", actionable: true, actionLabel: "查看澄清" },
  BID_CLARIFICATION_CREATED: { label: "评标澄清", group: "todo", tone: "warning", actionable: true, actionLabel: "提交答复" },
  CLARIFY_NOTICE: { label: "澄清公告", group: "project", tone: "info" },
  CLARIFICATION_REPLIED: { label: "澄清答复", group: "project", tone: "info" },
  BID_PUBLISHED: { label: "采购项目发布", group: "project", tone: "info" },
  BID_INVITED: { label: "项目邀请", group: "project", tone: "accent", actionable: true, actionLabel: "查看邀请" },
  BID_REMINDER: { label: "项目提醒", group: "project", tone: "warning", actionable: true },
  BID_OPENING: { label: "开标通知", group: "project", tone: "info" },
  BID_OPENING_STARTED: { label: "开标启动", group: "project", tone: "warning", actionable: true, actionLabel: "进入开标大厅" },
  BID_OPENING_CONFIRMED: { label: "开标确认", group: "project", tone: "success" },
  BID_OPENING_HANDED_OVER: { label: "开标移交", group: "project", tone: "info" },
  BID_EVALUATION_STARTED: { label: "评审启动", group: "project", tone: "accent" },
  BID_EVALUATION_RESULT: { label: "评审结果", group: "project", tone: "accent" },
  BID_SCHEDULE_CHANGE: { label: "日程变更", group: "project", tone: "warning", actionable: true, actionLabel: "查看新日程" },
  BID_DECRYPT_FAILED: { label: "解密异常", group: "project", tone: "danger", actionable: true, actionLabel: "查看开标状态" },
  BID_DECRYPT_ADJUDGED: { label: "解密裁决", group: "project", tone: "warning" },
  BID_DISPUTE_RESOLVED: { label: "异议处理", group: "project", tone: "info" },
  BID_DISPUTE_TIMEOUT: { label: "异议超时", group: "project", tone: "warning" },
  BID_ABORTED: { label: "项目终止", group: "project", tone: "danger" },
  ANNOUNCEMENT_PUBLISHED: { label: "公告发布", group: "project", tone: "info" },
  PRE_WIN_NOTICE: { label: "预成交公示", group: "project", tone: "accent" },
  WIN_NOTICE: { label: "成交公告", group: "project", tone: "success" },
  CONTRACT_NOTICE: { label: "合同通知", group: "contract", tone: "info", actionable: true, actionLabel: "查看合同" },
  PERFORMANCE_NOTICE: { label: "履约结果", group: "contract", tone: "success" },
  PREQUAL_NOTICE: { label: "资格预审", group: "approval", tone: "info" },
  CATALOG_APPLICATION: { label: "供货申请", group: "approval", tone: "info" },
  CATALOG_PRICE_ALERT: { label: "价格提醒", group: "approval", tone: "warning", actionable: true },
  SUPPLIER_PENDING: { label: "入库待审", group: "approval", tone: "info" },
  SUPPLIER_APPROVED: { label: "入库通过", group: "approval", tone: "success" },
  SUPPLIER_REJECTED: { label: "入库驳回", group: "approval", tone: "danger" },
  SUPPLIER_RETURNED: { label: "退回补正", group: "approval", tone: "warning", actionable: true, actionLabel: "补充资料" },
  SUPPLIER_BLACKLISTED: { label: "信用状态变更", group: "approval", tone: "danger" },
  SUPPLIER_UNBLACKLISTED: { label: "信用状态恢复", group: "approval", tone: "success" },
  PASSWORD_CHANGE_REVIEWED: { label: "密码申请结果", group: "approval", tone: "info" },
  PROFILE_CHANGE_REVIEWED: { label: "资料变更结果", group: "approval", tone: "info" },
  ACCOUNT_SECURITY_FEEDBACK: { label: "账号安全", group: "system", tone: "warning" },
  SYSTEM: { label: "系统通知", group: "system", tone: "neutral" },
};

const FALLBACK_META: NotificationMeta = { label: "其他消息", group: "system", tone: "neutral" };

export function getNotificationMeta(type: string): NotificationMeta {
  return META[type] ?? FALLBACK_META;
}

export function notificationTypesForGroup(group: NotificationGroup | "all"): string[] {
  if (group === "all") return [];
  return Object.entries(META)
    .filter(([, meta]) => meta.group === group)
    .map(([type]) => type);
}

export type ResolvedNotificationLink =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string };

function normalizeLegacyPath(pathname: string): string {
  if (pathname === "/award-letter") return "/award-letters";
  if (pathname === "/supplier/qualifications") return "/profile";
  const oldBid = /^\/supplier\/bid\/([^/]+)$/.exec(pathname);
  if (oldBid) return `/my-bids/${encodeURIComponent(decodeURIComponent(oldBid[1]))}/opening-hall`;
  const wrongOpeningPath = /^\/bids\/([^/]+)\/opening-hall$/.exec(pathname);
  return wrongOpeningPath
    ? `/my-bids/${encodeURIComponent(decodeURIComponent(wrongOpeningPath[1]))}/opening-hall`
    : pathname;
}

export function resolveNotificationLink(link: string | null | undefined, origin: string): ResolvedNotificationLink | null {
  const value = link?.trim();
  if (!value || (!value.startsWith("/") && !/^https?:\/\//i.test(value))) return null;
  try {
    const url = new URL(value, origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.origin === origin) {
      return { kind: "internal", href: `${normalizeLegacyPath(url.pathname)}${url.search}${url.hash}` };
    }
    return { kind: "external", href: url.href };
  } catch {
    return null;
  }
}

export function summarizeNotification(content: string, maxLength = 120): string {
  const normalized = content
    .replace(/请访问\s*https?:\/\/[^\s]+\s*完成确认[。.]?/gi, "请通过消息中的“查看详情”完成确认。")
    .replace(/https?:\/\/[^\s]+/gi, "[外部链接]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}
