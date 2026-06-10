import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const supplierId = request.params.id;

    if (!user) {
      throw new ForbiddenException({ error: '未登录', code: 'UNAUTHORIZED' });
    }

    if (user.role !== 'supplier') {
      // 非供应商用户可以查看，但只有供应商本人可以修改
      return true;
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: user.sub },
    });

    if (!supplier || supplier.id !== supplierId) {
      throw new ForbiddenException({ error: '只能操作自己的供应商信息', code: 'FORBIDDEN' });
    }

    return true;
  }
}