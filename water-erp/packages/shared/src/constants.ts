/* ============================================================================
   共享常量 — 所有门户应用的唯一常量来源
   ============================================================================ */

/* ── 品牌 ── */

export const BRAND = {
  name: '智慧水发 · 蜀水云采',
  nameEn: 'SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.',
  shortName: '智慧水发',
  systemName: '智慧水发·蜀水云采',
  logoPath: '/assets/logo.jpg',
  primary: '#064ea2',
  primaryHover: '#0e62d0',
  secondary: '#0891b2',
  navy: '#18243a',
} as const;

/* ── 语义色（全平台统一） ── */

export const SEMANTIC = {
  success: '#11a874',
  warning: '#f5a623',
  danger: '#e74c3c',
  info: '#5a6d8a',
} as const;

/* ── 投标阶段 ── */

export const STAGE_LABEL: Record<string, string> = {
  DOWNLOAD: '文件下载',
  SUBMIT: '加密投递',
  OPENING: '在线开标',
  EVALUATING: '专家评标',
  ARCHIVED: '资料归档',
  ABORTED: '流标',
};

export const STAGE_COLOR: Record<string, string> = {
  DOWNLOAD: '#0891b2',
  SUBMIT: '#064ea2',
  OPENING: '#f5a623',
  EVALUATING: '#7c3aed',
  ARCHIVED: '#11a874',
  ABORTED: '#e74c3c',
};

/* ── 供应商状态 ── */

export const SUPPLIER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  RETURNED: '已退回补正',
  APPROVED: '已入库',
  REJECTED: '审核不通过',
  DISABLED: '已停用',
  BLACKLIST: '黑名单',
};

/* ── 统一状态色板（替代各端分散的 statusMap / typeMap） ── */

export const STATUS_COLOR: Record<string, { label: string; color: string; bg: string }> = {
  // 供应商状态
  PENDING:   { label: '待审核',     color: '#f5a623', bg: '#f5a62318' },
  RETURNED:  { label: '已退回补正', color: '#e67e22', bg: '#e67e2218' },
  APPROVED:  { label: '已入库',     color: '#11a874', bg: '#11a87418' },
  REJECTED:  { label: '审核不通过', color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED:  { label: '已停用',     color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST: { label: '黑名单',     color: '#c0392b', bg: '#c0392b18' },
  // 公告状态
  DRAFT:     { label: '草稿',   color: '#8a9aaa', bg: '#8a9aaa18' },
  PUBLISHED: { label: '已发布', color: '#11a874', bg: '#11a87418' },
  ARCHIVED:  { label: '已归档', color: '#5a6d8a', bg: '#5a6d8a18' },
  // 公告类型
  BID_NOTICE: { label: '招标公告', color: '#064ea2', bg: '#064ea218' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874', bg: '#11a87418' },
  POLICY:     { label: '政策法规', color: '#f5a623', bg: '#f5a62318' },
  PLATFORM:   { label: '平台通知', color: '#5a6d8a', bg: '#5a6d8a18' },
  // 变更状态
  CHANGE_PENDING:  { label: '待审批', color: '#f5a623', bg: '#f5a62318' },
  CHANGE_APPROVED: { label: '已通过', color: '#11a874', bg: '#11a87418' },
  CHANGE_REJECTED: { label: '已拒绝', color: '#e74c3c', bg: '#e74c3c18' },
  // 资质状态
  VALID:    { label: '有效',     color: '#11a874', bg: '#11a87418' },
  EXPIRING: { label: '即将到期', color: '#f5a623', bg: '#f5a62318' },
  EXPIRED:  { label: '已过期',   color: '#e74c3c', bg: '#e74c3c18' },
};

/* ── 公告类型（保留向后兼容） ── */

export const ANNOUNCEMENT_TYPE_MAP: Record<string, { label: string; color: string }> = {
  BID_NOTICE: { label: '招标公告', color: '#064ea2' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874' },
  POLICY:     { label: '政策法规', color: '#f5a623' },
  PLATFORM:   { label: '平台通知', color: '#5a6d8a' },
};

/* ── 公告状态（保留向后兼容） ── */

export const ANNOUNCEMENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT:     { label: '草稿',   color: '#8a9aaa' },
  PUBLISHED: { label: '已发布', color: '#11a874' },
  ARCHIVED:  { label: '已归档', color: '#5a6d8a' },
};

/* ── 评分类别 ── */

export const CATEGORY_LABEL: Record<string, string> = {
  QUALIFICATION: '资格审查',
  RESPONSIVE: '响应性评审',
  BUSINESS: '商务评审',
  TECHNICAL: '技术评审',
  PRICE: '价格评审',
};

export const CATEGORY_COLOR: Record<string, string> = {
  QUALIFICATION: '#064ea2',
  RESPONSIVE: '#8b5cf6',
  BUSINESS: '#f5a623',
  TECHNICAL: '#11a874',
  PRICE: '#e74c3c',
};

/* ── 解密状态 ── */

export const DECRYPT_LABEL: Record<string, string> = {
  PENDING: '待解密',
  RUNNING: '解密中',
  SUCCESS: '已解密',
  DANGER: '异常',
};

/* ── 评价等级 ── */

export const LEVEL_COLOR: Record<string, string> = {
  A: '#059669',
  B: '#0a5eb8',
  C: '#d97706',
  D: '#ca8a04',
  E: '#dc2626',
};

export const LEVEL_LABEL: Record<string, string> = {
  A: '优秀',
  B: '良好',
  C: '合格',
  D: '待改进',
  E: '不合格',
};

/** 综合等级权重：qualityGrade × 0.5 + disciplineGrade × 0.3 + attendanceGrade × 0.2 */
export const LEVEL_WEIGHT = {
  qualityGrade: 0.5,
  disciplineGrade: 0.3,
  attendanceGrade: 0.2,
} as const;

/* ── 通知类型元数据 ── */
// icon = Lucide 图标名（前端按名渲染）；tone = 语义色；actionable = 是否进「待办」分段
export interface NotificationMeta {
  icon: string;
  tone: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  actionable: boolean;
}

export const NOTIFICATION_META: Record<string, NotificationMeta> = {
  SUPPLIER_APPROVED:       { icon: 'CheckCircle2',     tone: 'green',  actionable: false },
  SUPPLIER_REJECTED:       { icon: 'XCircle',           tone: 'red',    actionable: false },
  SUPPLIER_RETURNED:       { icon: 'RotateCcw',         tone: 'orange', actionable: false },
  SUPPLIER_PENDING:        { icon: 'UserCheck',         tone: 'blue',   actionable: true  },
  QUALIFICATION_EXPIRING:  { icon: 'AlertTriangle',     tone: 'orange', actionable: true  },
  BID_PUBLISHED:           { icon: 'Megaphone',         tone: 'blue',   actionable: false },
  BID_REMINDER:            { icon: 'Clock',             tone: 'orange', actionable: true  },
  BID_OPENING:             { icon: 'Gavel',             tone: 'blue',   actionable: false },
  BID_EVALUATION_RESULT:   { icon: 'Award',             tone: 'green',  actionable: false },
  CLARIFICATION_REPLIED:   { icon: 'MessageCircle',     tone: 'purple', actionable: false },
  HALL_MESSAGE:            { icon: 'MessagesSquare',   tone: 'blue',   actionable: true  },
  PRICE_REVIEW:            { icon: 'Tag',               tone: 'purple', actionable: true  },
  CATALOG_APPLICATION:     { icon: 'ShoppingBag',       tone: 'gray',   actionable: false },
  SYSTEM:                  { icon: 'Bell',              tone: 'gray',   actionable: false },
};

export const NOTIFICATION_META_DEFAULT: NotificationMeta = { icon: 'Bell', tone: 'gray', actionable: false };

export function getNotificationMeta(type: string): NotificationMeta {
  return NOTIFICATION_META[type] ?? NOTIFICATION_META_DEFAULT;
}

// 向后兼容：保留旧名（emoji 仍供其他门户过渡用）
export const NOTIFICATION_ICON: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIFICATION_META).map(([k]) => [k, '🔔']),
);

/* ── 姓名脱敏 ── */

/**
 * 将中文姓名中间字符替换为"某"，用于隐私保护展示。
 * - 单字：原样返回
 * - 两字："王蓉" → "王某"
 * - 三字："丁博文" → "丁某文"
 * - 四字及以上："欧阳文强" → "欧某某强"
 */
export function maskName(name: string): string {
  if (!name || name.length <= 1) return name;
  if (name.length === 2) return name[0] + '某';
  const middle = '某'.repeat(name.length - 2);
  return name[0] + middle + name[name.length - 1];
}

/** 通过性审查类别（通过/不通过），区别于数值打分类别。 */
export const PASS_FAIL_CATEGORIES = new Set(['QUALIFICATION', 'RESPONSIVE']);
export const isPassFailCategory = (category: string): boolean => PASS_FAIL_CATEGORIES.has(category);
