import type { AuthenticatedUser } from './auth.types';

export type AuthRole = 'admin' | 'leader' | 'staff' | 'bid_host' | 'supplier' | 'bid_expert' | 'mall';

/** Admin 和 bid_host 可以查看全局业务数据 */
export function canViewGlobalBusinessData(role: string): boolean {
  return role === 'leader' || role === 'admin' || role === 'bid_host' || role === 'staff';
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
