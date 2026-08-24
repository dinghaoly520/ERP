import { Body, BadRequestException, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { AUTHENTICATED_ROLES } from './auth-scope';

/**
 * 管理员「账号管理」（:3005 系统管理，2026-08-21）：
 * 对每一个注册账号可 新增 / 删除 / 修改密码 / 修改权限(角色) / 冻结 / 解冻。
 * 冻结账号登录提示「账号已被冻结」，存量会话被 AuthGuard 即时 401。
 */

class CreateAccountDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() displayName: string;
  @IsString() @MinLength(6) password: string;
  @IsString() @IsIn(AUTHENTICATED_ROLES as readonly string[]) role: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() departmentName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
}

class UpdateAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() displayName?: string;
  @IsOptional() @IsString() @IsIn(AUTHENTICATED_ROLES as readonly string[]) role?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() departmentName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() officeLocation?: string;
}

class ResetPasswordDto {
  @IsString() @MinLength(6) password: string;
}

const ACCOUNT_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  company: true,
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
  @ApiOperation({ summary: '账号列表（账号管理页）' })
  list() {
    return this.prisma.user.findMany({
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
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
    return this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        passwordHash: hashSync(dto.password, 10),
        role: dto.role,
        company: dto.company ?? null,
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
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.displayName !== undefined && { displayName: dto.displayName }),
          ...(dto.role !== undefined && { role: dto.role }),
          ...(dto.company !== undefined && { company: dto.company || null }),
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

  @Post(':id/reset-password')
  @ApiOperation({ summary: '重置密码（并吊销该账号全部 web 会话）' })
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash: hashSync(dto.password, 10), webSessionId: null },
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
      data: { isFrozen: true, webSessionId: null },
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
