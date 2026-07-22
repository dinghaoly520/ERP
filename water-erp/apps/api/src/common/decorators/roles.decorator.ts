import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * 角色装饰器 — 标记接口允许访问的角色列表
 * @example @Roles('admin', 'leader', 'staff')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
