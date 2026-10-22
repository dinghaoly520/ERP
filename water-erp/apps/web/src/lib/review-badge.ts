/**
 * 供应商审批待办角标共享口径（2026-10-22 综合统一）：
 * 待我审总数 = 注册 + 信息更新（资料变更 + 密码重置）+ 加入审批（多公司归属）。
 * 消费方：顶栏「供应商审批」按钮、供应商库「审批」按钮/KPI 卡——三处同源同口径；
 * 审批中心内完成审批后广播 REVIEW_BADGE_REFRESH_EVENT，各角标即时刷新（不等 30s 轮询）。
 */
export interface MyPendingReviewCount {
  registration?: number | null;
  changes?: number | null;
  resets?: number | null;
  joins?: number | null;
}

export const sumMyPending = (c: MyPendingReviewCount | null | undefined): number =>
  (c?.registration ?? 0) + (c?.changes ?? 0) + (c?.resets ?? 0) + (c?.joins ?? 0);

/** 悬停分解：注册 X · 信息更新 Y（含密码重置 Z）· 加入 W */
export const describeMyPending = (c: MyPendingReviewCount | null | undefined): string => {
  const reg = c?.registration ?? 0;
  const chg = (c?.changes ?? 0) + (c?.resets ?? 0);
  const rst = c?.resets ?? 0;
  const join = c?.joins ?? 0;
  return `注册 ${reg} · 信息更新 ${chg}${rst > 0 ? `（含密码重置 ${rst}）` : ''} · 加入 ${join}`;
};

/** 审批中心内动作完成 → 各处角标即时刷新 */
export const REVIEW_BADGE_REFRESH_EVENT = 'review-badge-refresh';
