/* ============================================================================
   共享常量 — 所有门户应用的唯一常量来源
   ============================================================================ */

/* ── 投标阶段 ── */

export const STAGE_LABEL: Record<string, string> = {
  DOWNLOAD: '文件下载',
  SUBMIT: '加密投递',
  OPENING: '在线开标',
  EVALUATING: '专家评标',
  ARCHIVED: '资料归档',
};

export const STAGE_COLOR: Record<string, string> = {
  DOWNLOAD: '#0891b2',
  SUBMIT: '#064ea2',
  OPENING: '#f5a623',
  EVALUATING: '#7c3aed',
  ARCHIVED: '#11a874',
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

/* ── 公告类型 ── */

export const ANNOUNCEMENT_TYPE_MAP: Record<string, { label: string; color: string }> = {
  BID_NOTICE: { label: '招标公告', color: '#064ea2' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874' },
  POLICY: { label: '政策法规', color: '#f5a623' },
  PLATFORM: { label: '平台通知', color: '#5a6d8a' },
};

/* ── 公告状态 ── */

export const ANNOUNCEMENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '草稿', color: '#8a9aaa' },
  PUBLISHED: { label: '已发布', color: '#11a874' },
  ARCHIVED: { label: '已归档', color: '#5a6d8a' },
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
  D: '#dc2626',
};

export const LEVEL_LABEL: Record<string, string> = {
  A: '优秀',
  B: '良好',
  C: '合格',
  D: '不合格',
};

/* ── 通知类型 ── */

export const NOTIFICATION_ICON: Record<string, string> = {
  SUPPLIER_APPROVED: '✅',
  SUPPLIER_REJECTED: '❌',
  SUPPLIER_RETURNED: '⚠️',
  BID_PUBLISHED: '📋',
  BID_REMINDER: '⏰',
  SYSTEM: '🔔',
};
