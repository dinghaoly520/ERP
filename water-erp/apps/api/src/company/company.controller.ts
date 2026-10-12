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
  // PATCH 局部更新（如仅设默认）不携带本字段——必须 @IsOptional；创建必填由控制器校验兜底
  @IsOptional()
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
  // PATCH 局部更新（如仅设默认）不携带本字段——必须 @IsOptional；创建必填由控制器校验兜底
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** 监督举报条目（2026-10-10 多条目版）：整块监督举报信息，编写时「监督举报」按钮选择；
 *  无独立名称（用户裁定删除），以「监督人」为条目标识（必填） */
export class SupervisionBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  // PATCH 局部更新（如仅设默认）不携带本字段——必须 @IsOptional；创建必填由控制器校验兜底
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
    const [companies, roleCounts, pmCounts, awardedAgg, entryCounts] = await Promise.all([
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
      // 在办项目口径（对齐进度页）：PMI ACTIVE；RECYCLED/TERMINATED 不计
      this.prisma.projectManagementItem.groupBy({
        by: ['companyId'],
        where: { companyId: { not: null }, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      // 业绩聚合（2026-10-12 口径修订）：已归档/合同额改与采购台账「已完成」同源——
      // ProcurementRound AWARDED（不含回收站）。此前读 PMI ARCHIVED/contractAmount，
      // 手工录入台账的已成交轮次（sourceType=MANUAL）全被漏计，KPI 恒 0/￥0。
      this.prisma.procurementRound.groupBy({
        by: ['companyId'],
        where: { companyId: { not: null }, resultStatus: 'AWARDED', isRecycled: false },
        _count: { _all: true },
        _sum: { awardAmount: true },
      }),
      // 条目计数（2026-10-12）：台账公司列「采购人 N · 地点 N · 监督 N」小字，条目维护入口可见性
      Promise.all([
        this.prisma.companyPurchaser.groupBy({ by: ['companyId'], _count: { _all: true } }),
        this.prisma.companyPlace.groupBy({ by: ['companyId'], _count: { _all: true } }),
        this.prisma.companySupervision.groupBy({ by: ['companyId'], _count: { _all: true } }),
      ]),
    ]);
    const byCompany = new Map<string, { office: number; expert: number }>();
    for (const g of roleCounts) {
      if (!g.companyId) continue;
      const rec = byCompany.get(g.companyId) ?? { office: 0, expert: 0 };
      if (['admin', 'leader', 'staff', 'bid_host'].includes(g.role)) rec.office += g._count;
      if (g.role === 'bid_expert') rec.expert += g._count;
      byCompany.set(g.companyId, rec);
    }
    const activeMap = new Map(pmCounts.map(g => [g.companyId as string, g._count._all]));
    const awardedMap = new Map(
      awardedAgg.map(g => [
        g.companyId as string,
        { archived: g._count._all, contract: Number(g._sum.awardAmount ?? 0) },
      ]),
    );
    const [purchaserCounts, placeCounts, supervisionCounts] = entryCounts;
    const countOf = (rows: Array<{ companyId: string | null; _count: { _all: number } }>, id: string) =>
      rows.find(g => g.companyId === id)?._count._all ?? 0;
    return companies.map(c => ({
      ...c,
      officeUsers: byCompany.get(c.id)?.office ?? 0,
      expertUsers: byCompany.get(c.id)?.expert ?? 0,
      activeProjects: activeMap.get(c.id) ?? 0,
      archivedCount: awardedMap.get(c.id)?.archived ?? 0,
      contractTotal: awardedMap.get(c.id)?.contract ?? 0,
      purchaserCount: countOf(purchaserCounts, c.id),
      placeCount: countOf(placeCounts, c.id),
      supervisionCount: countOf(supervisionCounts, c.id),
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
    return this.entryMutation(
      await this.resolveOwnCompanyId(user),
      'companyPurchaser',
      null,
      this.buildPurchaserCreate(dto),
    );
  }

  @Patch('my-info/purchasers/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '编辑采购人条目（设为默认时自动取消其他默认）' })
  async updatePurchaser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pid') pid: string,
    @Body() dto: PurchaserBodyDto,
  ) {
    return this.entryMutation(
      await this.resolveOwnCompanyId(user),
      'companyPurchaser',
      pid,
      this.buildPurchaserUpdate(dto),
    );
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
    return this.entryMutation(
      await this.resolveOwnCompanyId(user),
      'companyPlace',
      null,
      this.buildPlaceCreate(dto),
    );
  }

  @Patch('my-info/places/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '编辑开标地点条目（设为默认时自动取消其他默认）' })
  async updatePlace(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string, @Body() dto: PlaceBodyDto) {
    return this.entryMutation(
      await this.resolveOwnCompanyId(user),
      'companyPlace',
      pid,
      this.buildPlaceUpdate(dto),
    );
  }

  @Delete('my-info/places/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '删除开标地点条目' })
  async deletePlace(@CurrentUser() user: AuthenticatedUser, @Param('pid') pid: string) {
    return this.entryDelete(await this.resolveOwnCompanyId(user), 'companyPlace', pid);
  }

  @Post('my-info/supervisions')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '新增监督举报条目（监督人为必填标识；设为默认时自动取消其他默认）' })
  async addSupervision(@CurrentUser() user: AuthenticatedUser, @Body() dto: SupervisionBodyDto) {
    return this.entryMutation(
      await this.resolveOwnCompanyId(user),
      'companySupervision',
      null,
      this.buildSupervisionCreate(dto),
    );
  }

  @Patch('my-info/supervisions/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '编辑监督举报条目（设为默认时自动取消其他默认）' })
  async updateSupervision(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pid') pid: string,
    @Body() dto: SupervisionBodyDto,
  ) {
    return this.entryMutation(
      await this.resolveOwnCompanyId(user),
      'companySupervision',
      pid,
      this.buildSupervisionUpdate(dto),
    );
  }

  @Delete('my-info/supervisions/:pid')
  @Roles('leader', 'admin')
  @ApiOperation({ summary: '删除监督举报条目' })
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

  // ── admin 按公司条目维护（2026-10-12）：账号管理「公司信息管理」编辑窗口数据面——
  //    与 my-info 版同一套校验/写路径（build*Create/Update + entryMutation/entryDelete），
  //    差异仅在目标公司来自路径参数（admin 维护全量公司）而非登录人归属。──

  @Get(':id/info')
  @Roles('admin')
  @ApiOperation({ summary: '指定公司信息 + 三类条目（admin 编辑窗口数据源）' })
  async companyInfoById(@Param('id') id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true, name: true, shortName: true, code: true, createdAt: true,
        ...Object.fromEntries(COMPANY_INFO_FIELDS.map(f => [f, true])),
      },
    });
    if (!company) throw new NotFoundException('公司不存在');
    // 条目排序与 my-info 同口径：默认在前、同位次按创建时间
    const entryOrder = [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }];
    const [purchasers, places, supervisionProfiles] = await Promise.all([
      this.prisma.companyPurchaser.findMany({ where: { companyId: id }, orderBy: entryOrder }),
      this.prisma.companyPlace.findMany({ where: { companyId: id }, orderBy: entryOrder }),
      this.prisma.companySupervision.findMany({ where: { companyId: id }, orderBy: entryOrder }),
    ]);
    return { ...company, purchasers, places, supervisionProfiles };
  }

  @Post(':id/purchasers')
  @Roles('admin')
  @ApiOperation({ summary: '为指定公司新增采购人条目（admin 编辑窗口）' })
  async adminAddPurchaser(@Param('id') id: string, @Body() dto: PurchaserBodyDto) {
    await this.assertCompanyExists(id);
    return this.entryMutation(id, 'companyPurchaser', null, this.buildPurchaserCreate(dto));
  }

  @Patch(':id/purchasers/:pid')
  @Roles('admin')
  @ApiOperation({ summary: '编辑指定公司采购人条目（admin 编辑窗口）' })
  async adminUpdatePurchaser(@Param('id') id: string, @Param('pid') pid: string, @Body() dto: PurchaserBodyDto) {
    return this.entryMutation(id, 'companyPurchaser', pid, this.buildPurchaserUpdate(dto));
  }

  @Delete(':id/purchasers/:pid')
  @Roles('admin')
  @ApiOperation({ summary: '删除指定公司采购人条目（admin 编辑窗口）' })
  async adminDeletePurchaser(@Param('id') id: string, @Param('pid') pid: string) {
    return this.entryDelete(id, 'companyPurchaser', pid);
  }

  @Post(':id/places')
  @Roles('admin')
  @ApiOperation({ summary: '为指定公司新增开标地点条目（admin 编辑窗口）' })
  async adminAddPlace(@Param('id') id: string, @Body() dto: PlaceBodyDto) {
    await this.assertCompanyExists(id);
    return this.entryMutation(id, 'companyPlace', null, this.buildPlaceCreate(dto));
  }

  @Patch(':id/places/:pid')
  @Roles('admin')
  @ApiOperation({ summary: '编辑指定公司开标地点条目（admin 编辑窗口）' })
  async adminUpdatePlace(@Param('id') id: string, @Param('pid') pid: string, @Body() dto: PlaceBodyDto) {
    return this.entryMutation(id, 'companyPlace', pid, this.buildPlaceUpdate(dto));
  }

  @Delete(':id/places/:pid')
  @Roles('admin')
  @ApiOperation({ summary: '删除指定公司开标地点条目（admin 编辑窗口）' })
  async adminDeletePlace(@Param('id') id: string, @Param('pid') pid: string) {
    return this.entryDelete(id, 'companyPlace', pid);
  }

  @Post(':id/supervisions')
  @Roles('admin')
  @ApiOperation({ summary: '为指定公司新增监督举报条目（admin 编辑窗口）' })
  async adminAddSupervision(@Param('id') id: string, @Body() dto: SupervisionBodyDto) {
    await this.assertCompanyExists(id);
    return this.entryMutation(id, 'companySupervision', null, this.buildSupervisionCreate(dto));
  }

  @Patch(':id/supervisions/:pid')
  @Roles('admin')
  @ApiOperation({ summary: '编辑指定公司监督举报条目（admin 编辑窗口）' })
  async adminUpdateSupervision(@Param('id') id: string, @Param('pid') pid: string, @Body() dto: SupervisionBodyDto) {
    return this.entryMutation(id, 'companySupervision', pid, this.buildSupervisionUpdate(dto));
  }

  @Delete(':id/supervisions/:pid')
  @Roles('admin')
  @ApiOperation({ summary: '删除指定公司监督举报条目（admin 编辑窗口）' })
  async adminDeleteSupervision(@Param('id') id: string, @Param('pid') pid: string) {
    return this.entryDelete(id, 'companySupervision', pid);
  }

  /** 路径公司存在性闸（admin 创建路径用；编辑/删除由条目归属校验兜底 404） */
  private async assertCompanyExists(id: string) {
    const exists = await this.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('公司不存在');
  }

  /** 条目创建载荷（my-info 与 admin 版共用）：必填校验 + trim→null 归一 */
  private buildPurchaserCreate(dto: PurchaserBodyDto) {
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException({ error: '采购人姓名不能为空', code: 'PURCHASER_NAME_REQUIRED' });
    }
    return {
      name,
      phone: normalizeOptional(dto.phone),
      email: normalizeOptional(dto.email),
      isDefault: dto.isDefault ?? false,
    };
  }

  /** 条目更新载荷（PATCH 局部更新：仅携带出现的字段） */
  private buildPurchaserUpdate(dto: PurchaserBodyDto) {
    return {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.phone !== undefined && { phone: normalizeOptional(dto.phone) }),
      ...(dto.email !== undefined && { email: normalizeOptional(dto.email) }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    };
  }

  private buildPlaceCreate(dto: PlaceBodyDto) {
    const address = dto.address?.trim();
    if (!address) {
      throw new BadRequestException({ error: '地点地址不能为空', code: 'PLACE_REQUIRED' });
    }
    return { address, isDefault: dto.isDefault ?? false };
  }

  private buildPlaceUpdate(dto: PlaceBodyDto) {
    return {
      ...(dto.address !== undefined && { address: dto.address.trim() }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    };
  }

  private buildSupervisionCreate(dto: SupervisionBodyDto) {
    const contact = dto.contact?.trim();
    if (!contact) {
      throw new BadRequestException({ error: '监督人不能为空（条目以监督人为标识）', code: 'SUPERVISION_CONTACT_REQUIRED' });
    }
    return {
      department: normalizeOptional(dto.department),
      address: normalizeOptional(dto.address),
      contact: normalizeOptional(dto.contact),
      phone: normalizeOptional(dto.phone),
      isDefault: dto.isDefault ?? false,
    };
  }

  private buildSupervisionUpdate(dto: SupervisionBodyDto) {
    return {
      ...(dto.department !== undefined && { department: normalizeOptional(dto.department) }),
      ...(dto.address !== undefined && { address: normalizeOptional(dto.address) }),
      ...(dto.contact !== undefined && { contact: normalizeOptional(dto.contact) }),
      ...(dto.phone !== undefined && { phone: normalizeOptional(dto.phone) }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    };
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
