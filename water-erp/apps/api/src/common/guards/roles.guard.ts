import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ANY_ROLE_KEY } from '../decorators/any-role.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public() overrides @Roles() — AuthGuard also skips, user won't be set
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // @AnyRole() — 任何已登录用户（认证边界，非授权）
    const hasAnyRole = this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (hasAnyRole) {
      const { user } = context.switchToHttp().getRequest();
      if (!user) {
        throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
      }
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles decorator means public access (AuthGuard handles auth)
    if (!requiredRoles || requiredRoles.length === 0) {
      // TODO(Task 8): 翻转为 NO_ROLE_CONFIGURED 拒绝
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    }

    if (requiredRoles.includes(user.role)) {
      return true;
    }

    throw new ForbiddenException({ error: '无权访问', code: 'FORBIDDEN' });
  }
}
