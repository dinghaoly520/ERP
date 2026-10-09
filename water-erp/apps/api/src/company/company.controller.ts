import { BadRequestException, Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { INTERNAL_ROLES } from '../auth/auth-scope';

/** 公司主数据（admin 公司选择器 / 公司维度统计用） */
@ApiTags('公司')
@Controller('companies')
@Roles(...INTERNAL_ROLES)
export class CompanyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '公司列表（含用户数，管理端公司选择器用）' })
  async list() {
    // 账号计数拆口径（2026-09-26）：专家库公司隔离后专家账号也挂 companyId，
    // 单一 users 计数会把「办公 6 + 专家 29」误读成 35 个办公人员——按角色分组后合并
    const [companies, roleCounts] = await Promise.all([
      this.prisma.company.findMany({
        select: { id: true, name: true, shortName: true, _count: { select: { users: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.groupBy({ by: ['companyId', 'role'], _count: true }),
    ]);
    const byCompany = new Map<string, { office: number; expert: number }>();
    for (const g of roleCounts) {
      if (!g.companyId) continue;
      const rec = byCompany.get(g.companyId) ?? { office: 0, expert: 0 };
      if (['admin', 'leader', 'staff', 'bid_host'].includes(g.role)) rec.office += g._count;
      if (g.role === 'bid_expert') rec.expert += g._count;
      byCompany.set(g.companyId, rec);
    }
    return companies.map(c => ({
      ...c,
      _count: {
        users: c._count.users,
        officeUsers: byCompany.get(c.id)?.office ?? 0,
        expertUsers: byCompany.get(c.id)?.expert ?? 0,
      },
    }));
  }

  /** D4（A-205~A-207 裁剪）：单位管理视图——列表 + 每单位账号/项目业绩聚合 */
  @Get('management')
  @ApiOperation({ summary: '单位管理视图（A-205~207）：主数据 + 账号/项目业绩聚合' })
  async management() {
    const [companies, roleCounts, pmCounts, amountAgg] = await Promise.all([
      this.prisma.company.findMany({
        select: { id: true, name: true, shortName: true, code: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
      // 账号口径拆分（对齐 list() 2026-09-26 先例）：专家库公司隔离后专家也挂 companyId，
      // 单一 users 计数会把「在编 15 + 专家 187」误读成 202 个在编——按角色分组
      this.prisma.user.groupBy({ by: ['companyId', 'role'], _count: true }),
      // 项目口径（对齐 companyCounts 先例）：ACTIVE=在办、ARCHIVED=已完成（RECYCLED/TERMINATED 不计），
      // 此前的 pmItems 裸计数把回收站条目也计入立项数
      this.prisma.projectManagementItem.groupBy({
        by: ['companyId', 'status'],
        where: { companyId: { not: null }, status: { in: ['ACTIVE', 'ARCHIVED'] } },
        _count: { _all: true },
      }),
      // 业绩聚合：合同额合计（Decimal 求和在 DB 侧算）
      this.prisma.projectManagementItem.groupBy({
        by: ['companyId'],
        where: { companyId: { not: null }, contractAmount: { not: null } },
        _sum: { contractAmount: true },
      }),
    ]);
    const byCompany = new Map<string, { office: number; expert: number }>();
    for (const g of roleCounts) {
      if (!g.companyId) continue;
      const rec = byCompany.get(g.companyId) ?? { office: 0, expert: 0 };
      if (['admin', 'leader', 'staff', 'bid_host'].includes(g.role)) rec.office += g._count;
      if (g.role === 'bid_expert') rec.expert += g._count;
      byCompany.set(g.companyId, rec);
    }
    const pmByCompany = new Map<string, { active: number; archived: number }>();
    for (const g of pmCounts) {
      if (!g.companyId) continue;
      const rec = pmByCompany.get(g.companyId) ?? { active: 0, archived: 0 };
      if (g.status === 'ACTIVE') rec.active += g._count._all;
      if (g.status === 'ARCHIVED') rec.archived += g._count._all;
      pmByCompany.set(g.companyId, rec);
    }
    const amountMap = new Map(amountAgg.map(g => [g.companyId, Number(g._sum.contractAmount ?? 0)]));
    return companies.map(c => ({
      ...c,
      officeUsers: byCompany.get(c.id)?.office ?? 0,
      expertUsers: byCompany.get(c.id)?.expert ?? 0,
      activeProjects: pmByCompany.get(c.id)?.active ?? 0,
      archivedCount: pmByCompany.get(c.id)?.archived ?? 0,
      contractTotal: amountMap.get(c.id) ?? 0,
    }));
  }

  /** D4：单位主数据维护（改名同步唯一约束校验；仅 admin） */
  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: '编辑单位（名称/简称；A-205 单位信息维护）' })
  async update(@Param('id') id: string, @Body() body: { name?: string; shortName?: string | null }) {
    const exists = await this.prisma.company.findUnique({ where: { id } });
    if (!exists) throw new BadRequestException({ error: '单位不存在', code: 'NOT_FOUND' });
    const name = body.name?.trim();
    if (name && name !== exists.name) {
      const dup = await this.prisma.company.findUnique({ where: { name } });
      if (dup) throw new BadRequestException({ error: '已存在同名单位（主数据唯一）', code: 'DUPLICATE_NAME' });
    }
    return this.prisma.company.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(body.shortName !== undefined && { shortName: body.shortName?.trim() || null }),
      },
      select: { id: true, name: true, shortName: true },
    });
  }
}
