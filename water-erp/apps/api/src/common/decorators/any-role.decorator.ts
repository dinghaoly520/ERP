import { SetMetadata } from '@nestjs/common';

export const ANY_ROLE_KEY = 'any_role';

/**
 * 任何已登录用户可访问（认证边界，非授权）——适用于跨角色通用面。
 * AuthGuard 已保证非 @Public 路由存在 user；RolesGuard 仅校验 user 存在。
 * @example @AnyRole()
 */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
