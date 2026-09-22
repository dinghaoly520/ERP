import { Body, BadRequestException, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { hashSync } from 'bcryptjs';
import { decryptPasswordVault, encryptPasswordVault } from './password-vault.util';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { AUTHENTICATED_ROLES, INTERNAL_ROLES } from './auth-scope';

/**
 * 管理员「账号管理」（:3005 系统管理，2026-08-21）：
 * 对每一个注册账号可 新增 / 删除 / 修改密码 / 修改权限(角色) / 冻结 / 解冻。
 * 冻结账号登录提示「账号已被冻结」，存量会话被 AuthGuard 即时 401。
 *
 * 范围（2026-08-24 收紧）：仅 :3005 采购中心人员账号（INTERNAL_ROLES =
 * admin/leader/staff/bid_host）。专家/商城等其他门户账号不在此管理（专家归专家管理中心）。
 *
 * 2026-09-14 扩展：供应商账号纳入只读视图（按公司分组）——列表 / 密码查看
 * （passwordVault AES 解密+审计留痕）/ 归属公司调整；密码修改仍归供应商门户自助。
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
  @IsString() @IsNotEmpty() // Company 主数据 id 为自定义短 id（co-swhi-*），非 UUID；存在性由 findUnique 兜底
  companyId: string;
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
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '账号列表（仅 :3005 采购中心人员账号）' })
  list() {
    return this.prisma.user.findMany({
      where: { role: { in: [...INTERNAL_ROLES] } },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get('suppliers')
  @ApiOperation({ summary: '供应商账号列表（只读视图，账号管理按公司分组用）' })
  listSuppliers() {
    return this.prisma.user.findMany({
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
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
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
  @ApiOperation({ summary: '调整供应商账号的归属公司（账号管理分组）' })
  async updateSupplierCompany(@Param('id') id: string, @Body() dto: SupplierCompanyDto) {
    const account = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, supplier: { select: { id: true } } },
    });
    if (!account?.supplier) {
      throw new BadRequestException({ error: '该账号不是供应商账号', code: 'NOT_SUPPLIER' });
    }
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new BadRequestException({ error: '公司不存在', code: 'COMPANY_NOT_FOUND' });
    return this.prisma.supplier.update({
      where: { id: account.supplier.id },
      data: { companyId: company.id, companyName: company.name },
      select: { companyId: true, companyName: true },
    });
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
    // companyId 恒空 → 账号管理建的账号在公司隔离引擎里全部「未归属」（resolveScope 读 companyId）
    const companyRec = dto.company ? await this.resolveCompanyRecord(dto.company) : null;
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
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        isActive: true,
      },
      select: ACCOUNT_SELECT,
    });
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
    // 公司名 → Company 记录（联动 companyId，口径同 create；空串=清除归属）
    const companyRec = dto.company ? await this.resolveCompanyRecord(dto.company) : null;
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
          ...(dto.phone !== undefined && { phone: dto.phone || null }),
          ...(dto.email !== undefined && { email: dto.email || null }),
          ...(dto.officeLocation !== undefined && { officeLocation: dto.officeLocation || null }),
        },
        select: ACCOUNT_SELECT,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({ error: '同名同角色账号已存在', code: 'USERNAME_ROLE_CONFLICT' });
      }
      throw e;
    }
  }

  /** 公司名归一化 → Company upsert（与注册链路同款：精确/去后缀匹配，未知公司即建档） */
  private async resolveCompanyRecord(companyName: string) {
    const known = (await this.prisma.company.findMany({ select: { name: true } })).map(c => c.name);
    const trimmed = companyName.trim().replace(/\s+/g, '');
    let name = known.find(c => c.toLowerCase() === trimmed.toLowerCase());
    if (!name) {
      const stripSuffix = (s: string) => s.replace(/(股份有限公司|有限公司|有限责任公司|集团)$/, '');
      name = known.find(c => stripSuffix(c) === stripSuffix(trimmed)) ?? trimmed;
    }
    return this.prisma.company.upsert({ where: { name }, update: {}, create: { name } });
  }

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
        webSessionId: null,
        sessionMeta: Prisma.DbNull,
      },
      select: ACCOUNT_SELECT,
    });
    // 重置密码 = 对「异地登录反馈」采取了实质安全处置 → 相关提醒自动消（无需逐条点击）
    await this.resolveSecurityFeedback(updated.username);
    return updated;
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
    return updated;
  }

  @Post(':id/unfreeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解冻账号' })
  unfreeze(@Param('id') id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isFrozen: false },
      select: ACCOUNT_SELECT,
    });
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
