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
    return this.prisma.company.findMany({
      select: {
        id: true,
        name: true,
        shortName: true,
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** D4（A-205~A-207 裁剪）：单位管理视图——列表 + 每单位业绩（在办/已归档项目数、合同额合计） */
  @Get('management')
  @ApiOperation({ summary: '单位管理视图（A-205~207）：主数据 + 项目业绩聚合' })
  async management() {
    const companies = await this.prisma.company.findMany({
      select: {
        id: true,
        name: true,
        shortName: true,
        createdAt: true,
        _count: { select: { users: true, pmItems: true } },
      },
      orderBy: { name: 'asc' },
    });
    // 业绩聚合：PMI 归属快照上的已归档数 + 合同额合计（Decimal 求和在 DB 侧算）
    const [archivedAgg, amountAgg] = await Promise.all([
      this.prisma.projectManagementItem.groupBy({
        by: ['companyId'],
        where: { companyId: { not: null }, archivedAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.projectManagementItem.groupBy({
        by: ['companyId'],
        where: { companyId: { not: null }, contractAmount: { not: null } },
        _sum: { contractAmount: true },
      }),
    ]);
    const archivedMap = new Map(archivedAgg.map(g => [g.companyId, g._count._all]));
    const amountMap = new Map(amountAgg.map(g => [g.companyId, Number(g._sum.contractAmount ?? 0)]));
    return companies.map(c => ({
      ...c,
      archivedCount: archivedMap.get(c.id) ?? 0,
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
