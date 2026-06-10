import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class ProcurementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    }

    if (user.role !== 'procurement_staff' && user.role !== 'admin') {
      throw new ForbiddenException({ error: '无权操作，需要采购中心或管理员权限', code: 'FORBIDDEN' });
    }

    return true;
  }
}