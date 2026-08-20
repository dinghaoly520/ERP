import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 项目管理个人隔离守卫（2026-08-20 拍板 1C）：
 * 非创建人不可读/写他人项目，admin 全量放行。
 *
 * 挂在 ProjectManagementController 类级——凡是带 :id 路由参数的端点（约 18 个读/写端点，
 * 含 updateStage/attachments/analyze/reproc/complete/summary/attachment-file 等）统一校验；
 * 无 :id 的端点（list/create/extract-initiation/archive/:procurementRoundId）自动放行。
 * 此前仅 recycle/restore/delete 三个端点有守卫，其余 :id 端点 API 直调可越权，本守卫收口。
 */
@Injectable()
export class PmiOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id = req?.params?.id;
    if (!id) return true; // 非单项目路由（列表/创建/提取等）不校验

    const user = req.user;
    if (user?.role === 'admin') return true;

    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id },
      select: { createdById: true },
    });
    if (!item) return true; // 不存在 → 交给后续 404 语义

    if (item.createdById !== user?.sub) {
      throw new ForbiddenException({
        error: '该项目不属于当前账号，无权访问',
        code: 'PMI_OWNERSHIP_FORBIDDEN',
      });
    }
    return true;
  }
}
