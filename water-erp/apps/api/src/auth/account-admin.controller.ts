import { Body, BadRequestException, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { hashSync } from 'bcryptjs';
import { sealPii, openPiiForMask, blindIndexPii } from '../common/crypto/sm-field-crypto';
import { maskPhone, maskEmail } from '../common/pii-mask';
import { decryptPasswordVault, encryptPasswordVault } from './password-vault.util';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { AUTHENTICATED_ROLES, INTERNAL_ROLES } from './auth-scope';
import { planSupplierCompanySync } from './supplier-company-sync.util';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 管理员「账号管理」（:3005 系统管理，2026-08-21）：
 * 对每一个注册账号可 新增 / 删除 / 修改密码 / 修改权限(角色) / 冻结 / 解冻。
 * 冻结账号登录提示「账号已被冻结」，存量会话被 AuthGuard 即时 401。
 *
 * 范围（2026-08-24 收紧）：仅 :3005 采购中心人员账号（INTERNAL_ROLES =
 * admin/leader/staff/bid_host）。专家等其他门户账号不在此管理（专家归专家管理中心）。
 *
 * 2026-09-14 扩展：供应商账号纳入只读视图（按公司分组）——列表 / 密码查看
 * （passwordVault AES 解密+审计留痕）/ 归属公司调整；密码修改仍归供应商门户自助。
 * 2026-11-04 归属公司多选：归属=APPROVED SupplierCompanyLink 集合（与 :3004 隔离
 * 引擎同口径），多选保存=替换集（直批/移出），Supplier.companyId 快照同步主归属。
 */

class CreateAccountDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() displayName: string;
  @IsString() @MinLength(6) password: string;
  @IsString() @IsIn(INTERNAL_ROLES as readonly string[], { message: '账号管理仅支持采购中心角色（管理/办公权限等）' }) role: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() departmentName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}

class UpdateAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() displayName?: string;
  @IsOptional() @IsString() @IsIn(INTERNAL_ROLES as readonly string[], { message: '账号管理仅支持采购中心角色' }) role?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() departmentName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() officeLocation?: string;
}

class ResetPasswordDto {
  @IsString() @MinLength(6) password: string;
}

class SupplierCompanyDto {
  @IsArray() @IsString({ each: true }) // Company 主数据 id 为自定义短 id（co-swhi-*），非 UUID；存在性由 findMany 兜底
  companyIds: string[]; // 2026-11-04 多归属：替换集语义（空数组=全部移出）
}

/** 账号 PII 出口掩码（等保+密评）：列表/建号/改号返回一律掩码；明文走揭示类流程 */
function maskAccount<T extends { phone?: string | null; email?: string | null }>(user: T): T {
  return { ...user, phone: maskPhone(openPiiForMask(user.phone)), email: maskEmail(openPiiForMask(user.email)) };
}
function maskAccounts<T extends { phone?: string | null; email?: string | null }>(users: T[]): T[] {
  return users.map(maskAccount);
}

const ACCOUNT_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  company: true,
  companyId: true,
  departmentName: true,
  phone: true,
  email: true,
  officeLocation: true,
  isActive: true,
  isFrozen: true,
  createdAt: true,
} as const;

@ApiTags('认证')
@Controller('auth/admin/accounts')
@Roles('admin')
export class AccountAdminController {
  constructor(
    private readonly prisma: PrismaService,
    // 公司名→Company 记录统一收口（2026-11-06 改公司全链路联动裁定，逻辑移出本控制器）
    private readonly companyScope: CompanyScopeService,
  ) {}

  @Get()
  @ApiOperation({ summary: '账号列表（仅 :3005 采购中心人员账号）' })
  list() {
    return this.prisma.user.findMany({
      where: { role: { in: [...INTERNAL_ROLES] } },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    }).then(maskAccounts);
  }

  /** 待审批汇总（2026-09-22）：账号管理侧栏红标 + tab 红色角标数据源（注册/改密/重置/资料变更/安全反馈） */
  @Get('pending-summary')
  @ApiOperation({ summary: '待审批数量汇总（admin 角标）' })
  async pendingSummary() {
    const [registrations, passwordChanges, passwordResets, profileChanges, securityFeedback] = await Promise.all([
      this.prisma.user.count({ where: { role: 'internal_user', isActive: false } }),
      this.prisma.passwordChangeRequest.count({ where: { status: 'PENDING' } }),
      // 忘记密码计数与账号管理「忘记密码」段同口径（internal scope，2026-10-23 修复角标虚高）：
      // 供应商账号的重置申请归供应商审批中心处理（其角标已计 myCount.resets），此处计入会让
      // 安全审批角标=1 而下方三段全 0（用户实录）——排除 matchedUser.role=supplier 的申请
      this.prisma.passwordResetRequest.count({
        where: {
          status: 'PENDING',
          OR: [{ matchedUser: { is: { role: { not: 'supplier' } } } }, { matchedUserId: null }],
        },
      }),
      this.prisma.profileChangeRequest.count({ where: { status: 'PENDING' } }),
      Promise.resolve(0), // 安全反馈暂无独立表（通知随重置密码自动消），占位 0
    ]);
    return {
      registrations,
      passwordChanges,
      passwordResets,
      profileChanges,
      securityFeedback,
      total: registrations + passwordChanges + passwordResets + profileChanges + securityFeedback,
    };
  }

  @Get('suppliers')
  @ApiOperation({ summary: '供应商账号列表（只读视图，账号管理按公司分组用；带最近登录 IP）' })
  async listSuppliers() {
    const users = await this.prisma.user.findMany({
      where: { role: 'supplier' },
      select: {
        id: true,
        username: true,
        displayName: true,
        phone: true,
        email: true,
        isActive: true,
        isFrozen: true,
        createdAt: true,
        passwordVault: true, // 仅判存在（hasVault），明文绝不随列表下发
        supplier: {
          select: {
            name: true,
            creditCode: true,
            isTemporary: true,
            companyId: true,
            companyName: true,
            // 2026-11-04 多归属：APPROVED 链接集合（归属中公司），非 APPROVED 不入
            companyLinks: { select: { status: true, company: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    // 最近一次登录的 IP（AuditLog action=LOGIN 取最新一条）：列表「IP 地址」列 + 串号预警
    const logs = await this.prisma.auditLog.findMany({
      where: { userId: { in: users.map((u) => u.id) }, action: 'LOGIN' },
      select: { userId: true, ipAddress: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const lastLoginMap = new Map<string, { ip: string | null; at: string }>();
    for (const log of logs) {
      // AuditLog.userId 已可空（2026-11-09 断链保痕）；本查询 IN 非空 id 集运行时不为 null
      if (!log.userId) continue;
      if (!lastLoginMap.has(log.userId)) {
        lastLoginMap.set(log.userId, { ip: log.ipAddress, at: log.createdAt.toISOString() });
      }
    }
    return users.map((u) => {
      const { companyLinks, ...supplier } = u.supplier ?? ({} as NonNullable<typeof u.supplier>);
      const companies = (companyLinks ?? [])
        .filter((l) => l.status === 'APPROVED')
        .map((l) => l.company);
      return { ...u, supplier: supplier.name ? { ...supplier, companies } : null, lastLogin: lastLoginMap.get(u.id) ?? null };
    });
  }

  /** 单账号登录过的全部 IP（去重聚合 + 首末次时间）——「查看全部 IP」弹窗数据源 */
  @Get('login-ips/:id')
  @ApiOperation({ summary: '账号登录过的所有 IP（去重聚合）' })
  async loginIps(@Param('id') id: string) {
    const account = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true, role: true, supplier: { select: { name: true } } },
    });
    if (!account) throw new BadRequestException({ error: '账号不存在', code: 'ACCOUNT_NOT_FOUND' });
    const logs = await this.prisma.auditLog.findMany({
      where: { userId: id, action: 'LOGIN', ipAddress: { not: null } },
      select: { ipAddress: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // 按 IP 聚合：首末次登录时间 + 登录次数 + 最近 UA
    const byIp = new Map<string, { ip: string; firstAt: string; lastAt: string; count: number; lastUserAgent: string | null }>();
    for (const log of logs) {
      const ip = log.ipAddress as string;
      const entry = byIp.get(ip);
      if (entry) {
        entry.count += 1;
        entry.firstAt = log.createdAt.toISOString(); // logs 按 desc 遍历，越靠后越早
      } else {
        byIp.set(ip, { ip, firstAt: log.createdAt.toISOString(), lastAt: log.createdAt.toISOString(), count: 1, lastUserAgent: log.userAgent });
      }
    }
    return { account, ips: [...byIp.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)) };
  }

  /** 跨供应商同 IP 检测（2026-09-28）：不同供应商登录过相同 IP → 串号预警。
   *  排除 127.0.0.1（本地/代理回环——开发环境全员同 IP，无预警意义）。 */
  @Get('shared-ips')
  @ApiOperation({ summary: '跨供应商同 IP 登录检测（串号预警）' })
  async sharedIps() {
    const suppliers = await this.prisma.user.findMany({
      where: { role: 'supplier' },
      select: { id: true, username: true, displayName: true, supplier: { select: { name: true, isTemporary: true } } },
    });
    const nameOf = new Map(suppliers.map((s) => [s.id, s.supplier?.name ?? s.displayName ?? s.username]));
    const idSet = new Set(suppliers.map((s) => s.id));
    const logs = await this.prisma.auditLog.findMany({
      where: { userId: { in: [...idSet] }, action: 'LOGIN', ipAddress: { not: null, notIn: ['127.0.0.1'] } },
      select: { userId: true, ipAddress: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // ip → 供应商集合 + 时间
    const byIp = new Map<string, { suppliers: Map<string, { name: string; firstAt: string; lastAt: string }> }>();
    for (const log of logs) {
      const ip = log.ipAddress as string;
      if (!log.userId || !idSet.has(log.userId)) continue;
      let entry = byIp.get(ip);
      if (!entry) {
        entry = { suppliers: new Map() };
        byIp.set(ip, entry);
      }
      const su = entry.suppliers.get(log.userId);
      if (su) {
        su.firstAt = log.createdAt.toISOString(); // desc 遍历，越后越早
      } else {
        entry.suppliers.set(log.userId, { name: nameOf.get(log.userId) ?? log.userId, firstAt: log.createdAt.toISOString(), lastAt: log.createdAt.toISOString() });
      }
    }
    // 只保留 ≥2 个不同供应商共享的 IP
    return {
      shared: [...byIp.entries()]
        .filter(([, v]) => v.suppliers.size >= 2)
        .map(([ip, v]) => ({
          ip,
          suppliers: [...v.suppliers.values()].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => b.suppliers.length - a.suppliers.length),
    };
  }

  @Get(':id/password')
  @ApiOperation({ summary: '查看账号密码（passwordVault 解密；工作人员账号无副本返回 null）' })
  async revealPassword(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const account = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, role: true, passwordVault: true },
    });
    if (!account) throw new BadRequestException({ error: '账号不存在', code: 'NOT_FOUND' });
    const password = decryptPasswordVault(account.passwordVault);
    // 敏感操作留痕（审计失败不阻断，但不静默——日志兜底）
    this.prisma.auditLog
      .create({
        data: {
          userId: user.sub,
          action: '查看账号密码',
          resourceType: 'User',
          resourceId: account.id,
          details: { target: account.username, role: account.role, hit: password !== null },
        },
      })
      .catch(() => undefined);
    return { password, hasVault: password !== null };
  }

  @Patch(':id/supplier-company')
  @ApiOperation({ summary: '调整供应商账号的归属公司（多选替换集；APPROVED 链接 + 主归属快照同步）' })
  async updateSupplierCompany(
    @Param('id') id: string,
    @Body() dto: SupplierCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const account = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, supplier: { select: { id: true, name: true, companyId: true } } },
    });
    if (!account?.supplier) {
      throw new BadRequestException({ error: '该账号不是供应商账号', code: 'NOT_SUPPLIER' });
    }
    const supplier = account.supplier;
    const target = [...new Set(dto.companyIds)];
    // 替换集规划：授予差集直批 APPROVED（覆盖待审/停用/驳回）、目标外 APPROVED 移出
    const links = await this.prisma.supplierCompanyLink.findMany({
      where: { supplierId: supplier.id },
      select: { id: true, companyId: true, status: true },
    });
    // 公司名取「目标 ∪ 既有链接」并集——被移除公司也要有可读名（审计用）
    const companies = await this.prisma.company.findMany({
      where: { id: { in: [...new Set([...target, ...links.map((l) => l.companyId)])] } },
      select: { id: true, name: true },
    });
    const foundIds = new Set(companies.map((c) => c.id));
    if (target.some((id) => !foundIds.has(id))) {
      throw new BadRequestException({ error: '公司不存在', code: 'COMPANY_NOT_FOUND' });
    }
    const plan = planSupplierCompanySync(links, supplier.companyId, target);
    const nameOf = new Map(companies.map((c) => [c.id, c.name]));
    const nextPrimary = plan.nextPrimaryId ? { id: plan.nextPrimaryId, name: nameOf.get(plan.nextPrimaryId)! } : null;
    const now = new Date();
    await this.prisma.$transaction([
      ...plan.grantCompanyIds.map((companyId) =>
        this.prisma.supplierCompanyLink.upsert({
          where: { supplierId_companyId: { supplierId: supplier.id, companyId } },
          create: {
            supplierId: supplier.id, companyId, status: 'APPROVED', reviewStage: null,
            appliedAt: now, reviewedById: user.sub, reviewedAt: now,
          },
          update: { status: 'APPROVED', reviewStage: null, rejectReason: null, reviewedById: user.sub, reviewedAt: now },
          select: { id: true },
        }),
      ),
      ...plan.removeLinkIds.map((linkId) => this.prisma.supplierCompanyLink.delete({ where: { id: linkId } })),
      this.prisma.supplier.update({
        where: { id: supplier.id },
        data: { companyId: nextPrimary?.id ?? null, companyName: nextPrimary?.name ?? null },
        select: { id: true },
      }),
    ]);
    // 审计留痕（失败不阻断，与查看密码同款兜底）
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: user.sub,
          action: '调整供应商归属公司',
          resourceType: 'Supplier',
          resourceId: supplier.id,
          details: {
            supplier: supplier.name,
            added: plan.grantCompanyIds.map((cid) => nameOf.get(cid) ?? cid),
            removed: links
              .filter((l) => plan.removeLinkIds.includes(l.id))
              .map((l) => nameOf.get(l.companyId) ?? l.companyId),
            primary: nextPrimary?.name ?? null,
          },
        },
      });
    } catch {
      // 审计失败不阻断归属调整
    }
    const resultCompanies = companies.filter((c) => target.includes(c.id));
    return { companies: resultCompanies, companyId: nextPrimary?.id ?? null, companyName: nextPrimary?.name ?? null };
  }

  @Post()
  @ApiOperation({ summary: '新增账号（直接激活；用户名全局唯一）' })
  async create(@Body() dto: CreateAccountDto) {
    // 用户名全局查重（2026-08-24）：不限角色——任何账号占用该用户名即拒绝
    const taken = await this.prisma.user.findFirst({
      where: { username: dto.username },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException({ error: `用户名「${dto.username}」已被使用`, code: 'USERNAME_EXISTS' });
    }
    // 公司名 → Company 记录并联动 companyId（2026-09-17）：此前只写 company 文本、
    // companyId 恒空 → 账号管理建的账号在公司隔离引擎里全部「未归属」（resolveScope 读 companyId）。
    // 2026-11-06 收口到 CompanyScopeService.resolveCompanyRecord（注册/资料变更审批同源）
    const companyRec = dto.company ? await this.companyScope.resolveCompanyRecord(dto.company) : null;
    return this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        passwordHash: hashSync(dto.password, 10),
        passwordVault: encryptPasswordVault(dto.password) ?? null,
        role: dto.role,
        company: companyRec?.name ?? null,
        companyId: companyRec?.id ?? null,
        departmentName: dto.departmentName ?? null,
        phone: sealPii(dto.phone) ?? null, // PII 国密密封（等保+密评）
        phoneIdx: blindIndexPii(dto.phone) ?? null,
        email: sealPii(dto.email) ?? null,
        isActive: true,
      },
      select: ACCOUNT_SELECT,
    }).then(maskAccount);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改账号信息 / 权限（角色）' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // 防自锁：不允许改掉自己最后一个 admin 角色
    if (id === user.sub && dto.role && dto.role !== 'admin') {
      throw new BadRequestException({ error: '不能修改自己的管理员角色', code: 'SELF_ROLE_LOCK' });
    }
    // 公司名 → Company 记录（联动 companyId，口径同 create；空串=清除归属；2026-11-06 收口 CompanyScopeService）
    const companyRec = dto.company ? await this.companyScope.resolveCompanyRecord(dto.company) : null;
    // 掩码回声防御（2026-10-15）：编辑表单回填的是出口掩码（173****0762 / a***@x.com），
    // 原样提交会把掩码串密封入库 → 本人 /auth/me 拆封回显掩码 → 个人中心资料修改校验卡死。
    // 含 * 的 phone/email 一律视为「未修改」剔除（同 supervision authToken '******'=保持现有 惯例）；
    // 空串=清空、正常值=密封写入，语义不变。
    if (dto.phone?.includes('*')) dto.phone = undefined;
    if (dto.email?.includes('*')) dto.email = undefined;
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.displayName !== undefined && { displayName: dto.displayName }),
          ...(dto.role !== undefined && { role: dto.role }),
          ...(dto.company !== undefined && (dto.company
            ? { company: companyRec!.name, companyId: companyRec!.id }
            : { company: null, companyId: null })),
          ...(dto.departmentName !== undefined && { departmentName: dto.departmentName || null }),
          ...(dto.phone !== undefined && { phone: sealPii(dto.phone || null) ?? null, phoneIdx: dto.phone ? blindIndexPii(dto.phone) : null }), // PII 密封+盲索引同步
          ...(dto.email !== undefined && { email: sealPii(dto.email || null) ?? null }),
          ...(dto.officeLocation !== undefined && { officeLocation: dto.officeLocation || null }),
        },
        select: ACCOUNT_SELECT,
      }).then(maskAccount);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({ error: '同名同角色账号已存在', code: 'USERNAME_ROLE_CONFLICT' });
      }
      throw e;
    }
  }

  /** 公司名归一化 → Company upsert（与注册链路同款：精确/去后缀匹配，未知公司即建档） */
  @Post(':id/reset-password')
  @ApiOperation({ summary: '重置密码（并吊销该账号全部 web 会话）' })
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: hashSync(dto.password, 10),
        // 密码副本同步（2026-09-18 根因修复）：改密弹窗「原密码」读 vault 解密，
        // 此前重置只写 hash → 弹窗回显的是重置前的旧密码
        passwordVault: encryptPasswordVault(dto.password) ?? null,
        passwordChangedAt: new Date(), // R6-5①：全命名空间旧 token 立即失效
        webSessionId: null,
        sessionMeta: Prisma.DbNull,
      },
      select: ACCOUNT_SELECT,
    });
    // 重置密码 = 对「异地登录反馈」采取了实质安全处置 → 相关提醒自动消（无需逐条点击）
    await this.resolveSecurityFeedback(updated.username);
    return maskAccount(updated);
  }

  @Post(':id/freeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '冻结账号（登录拦截 + 存量会话即时失效）' })
  async freeze(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (id === user.sub) throw new BadRequestException({ error: '不能冻结自己的账号', code: 'SELF_LOCK' });
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isFrozen: true, webSessionId: null, sessionMeta: Prisma.DbNull },
      select: ACCOUNT_SELECT,
    });
    // 冻结 = 对「异地登录反馈」采取了实质安全处置 → 相关提醒自动消
    await this.resolveSecurityFeedback(updated.username);
    return maskAccount(updated);
  }

  @Post(':id/unfreeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解冻账号' })
  unfreeze(@Param('id') id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isFrozen: false },
      select: ACCOUNT_SELECT,
    }).then(maskAccount);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除账号（存在关联业务数据时拒绝，建议改冻结）' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (id === user.sub) throw new BadRequestException({ error: '不能删除自己的账号', code: 'SELF_LOCK' });
    try {
      await this.prisma.user.delete({ where: { id } });
      return { ok: true };
    } catch (e: any) {
      // 外键限制 = 该账号留有业务数据（项目/公告/评分等）
      if (e?.code === 'P2003') {
        throw new ConflictException({
          error: '该账号存在关联业务数据，无法删除；可改为「冻结」保留追溯',
          code: 'ACCOUNT_HAS_DATA',
        });
      }
      throw e;
    }
  }

  /** 对某账号采取了安全处置（重置密码/冻结）后，清除各管理员名下该账号的「异地登录反馈」（resolvedAt 打标） */
  private async resolveSecurityFeedback(username: string) {
    try {
      await this.prisma.notification.updateMany({
        where: {
          type: 'ACCOUNT_SECURITY_FEEDBACK',
          resolvedAt: null,
          content: { contains: `「${username}」` },
        },
        data: { resolvedAt: new Date() },
      });
    } catch { /* 清理失败不阻塞管理动作 */ }
  }
}
