import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { INTERNAL_ROLES } from '../auth/auth-scope';
import type { AuthenticatedUser } from '../auth/auth.types';

/** 公司信息管理（2026-10-10）可维护字段：开标地点 + 监督块四项 + 采购人四项（名称/简称单列处理） */
const COMPANY_INFO_FIELDS = [
  'bidOpeningAddress',
  'supervisionDept',
  'supervisionAddress',
  'supervisionContact',
  'supervisionPhone',
  'purchaserAddress',
  'purchaserContact',
  'purchaserPhone',
  'purchaserEmail',
] as const;

type CompanyInfoBody = {
  name?: string;
  shortName?: string | null;
} & Partial<Record<(typeof COMPANY_INFO_FIELDS)[number], string | null>>;

/** 采购人条目（2026-10-10 多人版）：多条信息、单默认——编写时「联系人」按钮选择 */
export class PurchaserBodyDto {
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** trim → null 归一（与公司信息字段同口径：空串入库 null，预填按空值回退默认） */
function normalizeOptional(v: string | null | undefined): string | null {
  return typeof v === 'string' ? v.trim() || null : null;
}

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
        select: {
          id: true,
          name: true,
          shortName: true,
          code: true,
          createdAt: true,
          ...Object.fromEntries(COMPANY_INFO_FIELDS.map(f => [f, true])),
        },
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

  /** 公司信息管理（2026-10-10）：登录人本公司信息——公司信息管理页数据源，
      亦是采购文件编写/公告编写按登录人公司预填监督/采购人/开标信息的取数口径 */
  @Get('my-info')
  @ApiOperation({ summary: '本公司信息（按登录人 companyId 解析）' })
  async myInfo(@CurrentUser() user: AuthenticatedUser) {
    const companyId = await this.resolveOwnCompanyId(user);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, shortName: true, code: true, createdAt: true,
        ...Object.fromEntries(COMPANY_INFO_FIELDS.map(f => [f, true])),
      },
    });
    // companyId 悬空兜底（公司主数据被删后账号未清理）：给可读错误而非 null
    if (!company) {
      throw new BadRequestException({ error: '所属公司不存在（可能已被删除），请联系管理员处理', code: 'COMPANY_NOT_FOUND' });
    }
    // 采购人条目（2026-10-10 多人版）：默认在前、同位次按创建时间——预填取首个
    const purchasers = await this.prisma.companyPurchaser.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { ...company, purchasers };
  }

  // ── 采购人条目维护（2026-10-10 多人版）：leader/admin，本公司范围 ──

  @Post('my-info/purchasers')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '新增采购人条目（设为默认时自动取消其他默认）' })
  async addPurchaser(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaserBodyDto) {
    const companyId = await this.resolveOwnCompanyId(user);
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException({ error: '采购人姓名不能为空', code: 'PURCHASER_NAME_REQUIRED' });
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.companyPurchaser.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.companyPurchaser.create({
        data: {
          companyId,
          name,
          phone: normalizeOptional(dto.phone),
          email: normalizeOptional(dto.email),
          isDefault: dto.isDefault ?? false,
        },
      });
    });
  }

  @Patch('my-info/purchasers/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '编辑采购人条目（设为默认时自动取消其他默认）' })
  async updatePurchaser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pid') pid: string,
    @Body() dto: PurchaserBodyDto,
  ) {
    const companyId = await this.resolveOwnCompanyId(user);
    const existing = await this.prisma.companyPurchaser.findUnique({ where: { id: pid } });
    // 越权与不存在统一 404（不泄露其他公司条目存在性）
    if (!existing || existing.companyId !== companyId) {
      throw new NotFoundException('采购人条目不存在');
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.companyPurchaser.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      return tx.companyPurchaser.update({
        where: { id: pid },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.phone !== undefined && { phone: normalizeOptional(dto.phone) }),
          ...(dto.email !== undefined && { email: normalizeOptional(dto.email) }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        },
      });
    });
  }

  @Delete('my-info/purchasers/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '删除采购人条目' })
  async deletePurchaser(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string) {
    const companyId = await this.resolveOwnCompanyId(user);
    const existing = await this.prisma.companyPurchaser.findUnique({ where: { id: pid } });
    if (!existing || existing.companyId !== companyId) {
      throw new NotFoundException('采购人条目不存在');
    }
    await this.prisma.companyPurchaser.delete({ where: { id: pid } });
    return { id: pid };
  }

  /** 公司信息管理页保存：维护本公司 名称/简称 + 开标/监督/采购人信息。
      维护权限 = leader/admin（staff/bid_host 只读预填，侧栏亦不展示入口） */
  @Patch('my-info')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '维护本公司信息（名称/简称 + 开标地点 + 监督块 + 采购人）' })
  async updateMyInfo(@CurrentUser() user: AuthenticatedUser, @Body() body: CompanyInfoBody) {
    const companyId = await this.resolveOwnCompanyId(user);
    return this.updateCompany(companyId, body);
  }

  /** D4：单位主数据维护（改名同步唯一约束校验；仅 admin）——2026-10-10 起同表单可维护公司信息字段 */
  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: '编辑单位（名称/简称/公司信息；A-205 单位信息维护）' })
  async update(@Param('id') id: string, @Body() body: CompanyInfoBody) {
    return this.updateCompany(id, body);
  }

  /** 登录人 → 本公司 id（未归属公司的账号不可用公司信息管理） */
  private async resolveOwnCompanyId(user: AuthenticatedUser): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { companyId: true },
    });
    if (!u?.companyId) {
      throw new BadRequestException({ error: '当前账号未归属公司，无法维护公司信息', code: 'NO_COMPANY' });
    }
    return u.companyId;
  }

  /** 共享更新：名称唯一校验 + 信息字段 trim→null 归一（空串存 null，导出预填按空值回退默认） */
  private async updateCompany(id: string, body: CompanyInfoBody) {
    const exists = await this.prisma.company.findUnique({ where: { id } });
    if (!exists) throw new BadRequestException({ error: '单位不存在', code: 'NOT_FOUND' });
    const name = body.name?.trim();
    if (name && name !== exists.name) {
      const dup = await this.prisma.company.findUnique({ where: { name } });
      if (dup) throw new BadRequestException({ error: '已存在同名单位（主数据唯一）', code: 'DUPLICATE_NAME' });
    }
    const info: Record<string, string | null> = {};
    for (const f of COMPANY_INFO_FIELDS) {
      const v = body[f];
      if (v !== undefined) info[f] = typeof v === 'string' ? v.trim() || null : null;
    }
    try {
      return await this.prisma.company.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(body.shortName !== undefined && { shortName: body.shortName?.trim() || null }),
          ...info,
        },
        select: {
          id: true, name: true, shortName: true, code: true,
          ...Object.fromEntries(COMPANY_INFO_FIELDS.map(f => [f, true])),
        },
      });
    } catch (e) {
      // 唯一约束兜底（check-then-update 的并发窗口）：撞名给友好错误而非原始 P2002
      if ((e as { code?: string })?.code === 'P2002') {
        throw new BadRequestException({ error: '已存在同名单位（主数据唯一）', code: 'DUPLICATE_NAME' });
      }
      throw e;
    }
  }
}
