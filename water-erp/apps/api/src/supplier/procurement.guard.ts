import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class ProcurementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    }

    // 与 controller 的 @Roles 对齐：DB 实际角色集为 admin/leader/staff/bid_expert/supplier，
    // 采购中心管理操作放行 admin 与内部采购角色 leader/staff。
    const ALLOWED = new Set(['admin', 'leader', 'staff']);
    if (!ALLOWED.has(user.role)) {
      throw new ForbiddenException({ error: '无权操作，需要采购中心或管理员权限', code: 'FORBIDDEN' });
    }

    return true;
  }
}