import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 开标主持操作守卫（2026-10-15）：主持人指派扩展为项目公司内员工（bid_host/leader/staff）后，
 * 现场执行权跟随「指派」而非角色——
 *  - admin 全量放行；
 *  - 被指派主持人本人放行（角色不限，与 BidCompanyScopeGuard「:3007 执行权来自指派」口径闭环）；
 *  - 其余（含同公司未指派的 bid_host）403——对齐主持人选择器「其它主持人看不到」的既有承诺，
 *    亦保证评标室口令明文等敏感端点不因角色放宽而泄露给未指派人员。
 * 挂法：方法级 @Roles('admin','bid_host','leader','staff') + @UseGuards(AssignedHostGuard)——
 * 角色集负责放行内部四角色，本守卫负责「仅指派人/admin」的收口。
 */
@Injectable()
export class AssignedHostGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id = req?.params?.id;
    if (!id) return true; // 无 :id 的端点不在收口范围

    const user = req?.user;
    if (!user || user.role === 'admin') return true;

    const proj = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { assignedHostUserId: true },
    });
    if (!proj) return true; // 不存在 → 后续 404 语义（与 BidCompanyScopeGuard 一致）
    if (proj.assignedHostUserId === user.sub) return true;

    throw new ForbiddenException({
      error: '仅被指派的主持人（或管理员）可执行该操作',
      code: 'NOT_ASSIGNED_HOST',
    });
  }
}
