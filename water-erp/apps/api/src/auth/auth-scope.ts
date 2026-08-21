import type { AuthenticatedUser } from './auth.types';

export type AuthRole = 'admin' | 'leader' | 'staff' | 'bid_host' | 'supplier' | 'bid_expert' | 'mall';

/**
 * 所有「已登录即合法」的角色全集。
 *
 * 用于那些「任何已登录用户都可访问自己的数据」类端点（如通知、个人设置、个人印记、
 * 文件上传），与 RolesGuard 的默认放行行为等价，但显式声明可让授权意图可读、可审计，
 * 并为将来 RolesGuard 改为默认拒绝时无需再补装饰器。
 */
export const AUTHENTICATED_ROLES: readonly AuthRole[] = [
  'admin', 'leader', 'staff', 'bid_host', 'supplier', 'bid_expert', 'mall',
];

/** 内部角色（采购办/开标现场）—— 可查看全局业务数据。 */
export const INTERNAL_ROLES: readonly AuthRole[] = ['admin', 'leader', 'staff', 'bid_host'];

/** Admin 和 bid_host 可以查看全局业务数据 */
export function canViewGlobalBusinessData(role: string): boolean {
  // 2026-08-20 拍板：数据库/台账/采购进度仅管理权限（leader/admin）——staff 不开放，
  // 与前端 DATABASE_ACCESS_ROLES={admin,leader} 同口径（此前误含 staff/bid_host，API 直调可绕过前端闸）
  return role === 'leader' || role === 'admin';
}

/** 只有 admin 可以查看全部用户活动日志 */
export function canViewAllUserActivity(role: string): boolean {
  return role === 'admin';
}

/** 按用户角色限缩数据范围 */
export function scopeToUser(user: AuthenticatedUser): Record<string, string> {
  if (user.role === 'staff') {
    return { createdById: user.sub };
  }
  return {};
}
