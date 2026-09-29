import { SetMetadata } from '@nestjs/common';

/**
 * 可选认证：无 token 的匿名请求放行（`req.user = null`，由端点自行赋予访客语义）；
 * 携带 token 则照常校验（无效/过期仍 401，不静默降级为匿名）。
 *
 * 与 @Public() 的区别：Public 完全跳过认证（req.user 永不注入）；
 * OptionalAuth 用于"登录与匿名共用同一端点、行为按认证态分层"的场景
 * （如水叮当助手：:3008 公共匿名 + :3005 登录用户）。
 *
 * 仅标注 @OptionalAuth（不叠加 @Roles）时 RolesGuard 放行——授权语义由端点自理；
 * 叠加 @Roles 时按 @Roles 校验（匿名请求 403 UNAUTHORIZED）。
 */
export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
