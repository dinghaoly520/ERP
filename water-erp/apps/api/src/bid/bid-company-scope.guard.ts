import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { portalFromRequest } from '../auth/portal-cookie';

/** 受公司隔离约束的内部角色（供应商/专家走各自既有授权，不在此列） */
const COMPANY_BOUND_ROLES = new Set(['leader', 'staff', 'bid_host']);

/**
 * 开评标模块公司隔离守卫（2026-08-20 拍板：跨公司不可见项目，自然不可见开标确认）。
 * 挂在 BidController 类级，覆盖全部 projects/:id/* 端点（详情/工作台/开标/评标/归档…）：
 *  - admin：全量放行；
 *  - :3007（portal=bid）：被指派人可执行被指派项目（现场执行权来自指派，跨公司指派属运营决策）；
 *  - 其余内部角色（leader/staff/bid_host，含 :3005 开标确认面板）：仅限本公司项目，跨公司 403；
 *  - 无 :id 的端点（列表/驾驶舱统计/主持人列表）不在此校验——列表过滤在 service 层。
 */
@Injectable()
export class BidCompanyScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id = req?.params?.id;
    if (!id) return true;

    const user = req?.user;
    if (!user || user.role === 'admin') return true;
    if (!COMPANY_BOUND_ROLES.has(user.role)) return true; // supplier/bid_expert 等走既有授权

    const proj = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { companyId: true, assignedHostUserId: true },
    });
    if (!proj) return true; // 不存在 → 后续 404 语义

    // :3007 现场：执行权来自指派（含跨公司指派的运营决策）
    if (portalFromRequest(req) === 'bid' && proj.assignedHostUserId === user.sub) return true;

    // 内部角色：仅限本公司
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { companyId: true },
    });
    if (me?.companyId && proj.companyId === me.companyId) return true;

    throw new ForbiddenException({
      error: '该项目不属于本公司，无权访问开评标数据',
      code: 'COMPANY_SCOPE_FORBIDDEN',
    });
  }
}
