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

/** 开标地点条目（2026-10-10 多条目版）：编写时「开标地点」按钮选择 */
export class PlaceBodyDto {
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** 监督信息方案条目（2026-10-10 多条目版）：整块监督举报信息，编写时「监督方案」按钮选择 */
export class SupervisionBodyDto {
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

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
    // 条目类（2026-10-10 多条目版）：默认在前、同位次按创建时间——预填取首个
    const entryOrder = [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }];
    const [purchasers, places, supervisionProfiles] = await Promise.all([
      this.prisma.companyPurchaser.findMany({ where: { companyId }, orderBy: entryOrder }),
      this.prisma.companyPlace.findMany({ where: { companyId }, orderBy: entryOrder }),
      this.prisma.companySupervision.findMany({ where: { companyId }, orderBy: entryOrder }),
    ]);
    return { ...company, purchasers, places, supervisionProfiles };
  }

  // ── 条目类维护（2026-10-10 多条目版）：采购人 / 开标地点 / 监督方案——同构 CRUD，leader/admin，本公司范围 ──

  @Post('my-info/purchasers')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '新增采购人条目（设为默认时自动取消其他默认）' })
  async addPurchaser(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaserBodyDto) {
    const companyId = await this.resolveOwnCompanyId(user);
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException({ error: '采购人姓名不能为空', code: 'PURCHASER_NAME_REQUIRED' });
    }
    return this.entryMutation(companyId, 'companyPurchaser', null, {
      name,
      phone: normalizeOptional(dto.phone),
      email: normalizeOptional(dto.email),
      isDefault: dto.isDefault ?? false,
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
    return this.entryMutation(companyId, 'companyPurchaser', pid, {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.phone !== undefined && { phone: normalizeOptional(dto.phone) }),
      ...(dto.email !== undefined && { email: normalizeOptional(dto.email) }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    });
  }

  @Delete('my-info/purchasers/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '删除采购人条目' })
  async deletePurchaser(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string) {
    return this.entryDelete(await this.resolveOwnCompanyId(user), 'companyPurchaser', pid);
  }

  @Post('my-info/places')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '新增开标地点条目（设为默认时自动取消其他默认）' })
  async addPlace(@CurrentUser() user: AuthenticatedUser, @Body() dto: PlaceBodyDto) {
    const companyId = await this.resolveOwnCompanyId(user);
    const label = dto.label?.trim();
    const address = dto.address?.trim();
    if (!label || !address) {
      throw new BadRequestException({ error: '地点名称与地址不能为空', code: 'PLACE_REQUIRED' });
    }
    return this.entryMutation(companyId, 'companyPlace', null, {
      label,
      address,
      isDefault: dto.isDefault ?? false,
    });
  }

  @Patch('my-info/places/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '编辑开标地点条目（设为默认时自动取消其他默认）' })
  async updatePlace(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string, @Body() dto: PlaceBodyDto) {
    const companyId = await this.resolveOwnCompanyId(user);
    return this.entryMutation(companyId, 'companyPlace', pid, {
      ...(dto.label !== undefined && { label: dto.label.trim() }),
      ...(dto.address !== undefined && { address: dto.address.trim() }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    });
  }

  @Delete('my-info/places/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '删除开标地点条目' })
  async deletePlace(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string) {
    return this.entryDelete(await this.resolveOwnCompanyId(user), 'companyPlace', pid);
  }

  @Post('my-info/supervisions')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '新增监督方案条目（设为默认时自动取消其他默认）' })
  async addSupervision(@CurrentUser() user: AuthenticatedUser, @Body() dto: SupervisionBodyDto) {
    const companyId = await this.resolveOwnCompanyId(user);
    const label = dto.label?.trim();
    if (!label) {
      throw new BadRequestException({ error: '方案名称不能为空', code: 'SUPERVISION_LABEL_REQUIRED' });
    }
    return this.entryMutation(companyId, 'companySupervision', null, {
      label,
      department: normalizeOptional(dto.department),
      address: normalizeOptional(dto.address),
      contact: normalizeOptional(dto.contact),
      phone: normalizeOptional(dto.phone),
      isDefault: dto.isDefault ?? false,
    });
  }

  @Patch('my-info/supervisions/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '编辑监督方案条目（设为默认时自动取消其他默认）' })
  async updateSupervision(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pid') pid: string,
    @Body() dto: SupervisionBodyDto,
  ) {
    const companyId = await this.resolveOwnCompanyId(user);
    return this.entryMutation(companyId, 'companySupervision', pid, {
      ...(dto.label !== undefined && { label: dto.label.trim() }),
      ...(dto.department !== undefined && { department: normalizeOptional(dto.department) }),
      ...(dto.address !== undefined && { address: normalizeOptional(dto.address) }),
      ...(dto.contact !== undefined && { contact: normalizeOptional(dto.contact) }),
      ...(dto.phone !== undefined && { phone: normalizeOptional(dto.phone) }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    });
  }

  @Delete('my-info/supervisions/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '删除监督方案条目' })
  async deleteSupervision(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string) {
    return this.entryDelete(await this.resolveOwnCompanyId(user), 'companySupervision', pid);
  }

  /** 条目类共用写路径：归属校验（越权与不存在统一 404）→ 默认互斥清位 → 事务写 */
  private async entryMutation(
    companyId: string,
    model: 'companyPurchaser' | 'companyPlace' | 'companySupervision',
    pid: string | null,
    data: Record<string, unknown>,
  ) {
    type EntryDelegate = {
      findUnique(args: { where: { id: string } }): Promise<{ companyId: string } | null>;
      updateMany(args: unknown): Promise<unknown>;
      create(args: unknown): Promise<unknown>;
      update(args: unknown): Promise<unknown>;
      delete(args: unknown): Promise<unknown>;
    };
    const delegateOf = (source: object): EntryDelegate =>
      (source as unknown as Record<string, EntryDelegate>)[model];
    if (pid) {
      const existing = await delegateOf(this.prisma).findUnique({ where: { id: pid } });
      if (!existing || existing.companyId !== companyId) {
        throw new NotFoundException('条目不存在');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const delegate = delegateOf(tx);
      if (data.isDefault === true) {
        await delegate.updateMany({ where: { companyId }, data: { isDefault: false } });
      }
      if (!pid) return delegate.create({ data: { ...data, companyId } });
      return delegate.update({ where: { id: pid }, data });
    });
  }

  private async entryDelete(
    companyId: string,
    model: 'companyPurchaser' | 'companyPlace' | 'companySupervision',
    pid: string,
  ) {
    type EntryDelegate = {
      findUnique(args: { where: { id: string } }): Promise<{ companyId: string } | null>;
      delete(args: unknown): Promise<unknown>;
    };
    const delegate = (this.prisma as unknown as Record<string, EntryDelegate>)[model];
    const existing = await delegate.findUnique({ where: { id: pid } });
    if (!existing || existing.companyId !== companyId) {
      throw new NotFoundException('条目不存在');
    }
    await delegate.delete({ where: { id: pid } });
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
