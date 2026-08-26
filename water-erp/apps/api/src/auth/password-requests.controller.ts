import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../common/validators/password-strength';
import { Request } from 'express';
import { PasswordRequestsService } from './password-requests.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';

class SubmitChangeDto {
  @IsString() @IsNotEmpty() currentPassword: string;
  @IsString() @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE }) newPassword: string;
}

class SubmitResetDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() applicantName: string;
  @IsString() @IsNotEmpty() applicantContact: string;
}

class RejectDto {
  @IsString() note?: string;
}

class SubmitProfileChangeDto {
  /** 资料白名单字段的期望新值（null = 清除）；与当前值相同的字段会被服务端忽略 */
  @IsOptional() @IsString() displayName?: string | null;
  @IsOptional() @IsString() email?: string | null;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsString() officeLocation?: string | null;
  @IsOptional() @IsString() company?: string | null;
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() avatar?: string | null;
}

/**
 * 密码变更/重置（2026-08-21 补齐）：
 *  - 用户端：个人中心改密申请、登录页忘记密码重置申请（模型早已有，此前无后端实现）
 *  - 管理端：密码审批（合并进 :3005 账号管理页）
 */
@ApiTags('认证')
@Controller('auth')
export class PasswordRequestsController {
  constructor(private readonly service: PasswordRequestsService) {}

  // ── 用户端 ──

  @Post('password-change-requests')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '提交修改密码申请（管理员审批后生效）' })
  submitChange(@CurrentUser('sub') userId: string, @Body() dto: SubmitChangeDto) {
    return this.service.submitChange(userId, dto.currentPassword, dto.newPassword);
  }

  @Post('profile-change-requests')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '提交资料变更申请（个人中心所有资料修改一律走审批）' })
  submitProfileChange(@CurrentUser('sub') userId: string, @Body() dto: SubmitProfileChangeDto) {
    return this.service.submitProfileChange(userId, dto as Record<string, string | null>);
  }

  @Post('password-reset-requests')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '忘记密码：提交重置申请（管理员审批后发放临时密码）' })
  submitReset(@Body() dto: SubmitResetDto) {
    return this.service.submitReset(dto.username, dto.applicantName, dto.applicantContact);
  }

  // ── 管理端（admin/leader）──

  @Get('admin/password-change-requests')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '待审批的改密申请列表' })
  listChanges() {
    return this.service.listPendingChanges();
  }

  @Post('admin/password-change-requests/:id/approve')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '批准改密（新密码生效并吊销该账号 web 会话）' })
  approveChange(@Param('id') id: string, @CurrentUser('sub') reviewerId: string) {
    return this.service.approveChange(id, reviewerId);
  }

  @Post('admin/password-change-requests/:id/reject')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '拒绝改密申请' })
  rejectChange(
    @Param('id') id: string,
    @CurrentUser('sub') reviewerId: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.rejectChange(id, reviewerId, dto.note);
  }

  @Get('admin/password-reset-requests')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '待审批的密码重置申请列表' })
  listResets() {
    return this.service.listPendingResets();
  }

  @Post('admin/password-reset-requests/:id/approve')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '批准重置：生成一次性临时密码（仅本次响应返回）' })
  approveReset(@Param('id') id: string, @CurrentUser('sub') reviewerId: string) {
    return this.service.approveReset(id, reviewerId);
  }

  @Post('admin/password-reset-requests/:id/reject')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '拒绝密码重置申请' })
  rejectReset(
    @Param('id') id: string,
    @CurrentUser('sub') reviewerId: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.rejectReset(id, reviewerId, dto.note);
  }

  @Get('admin/profile-change-requests')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '待审批的资料变更申请列表（含当前值旧值对照）' })
  listProfileChanges() {
    return this.service.listPendingProfileChanges();
  }

  @Post('admin/profile-change-requests/:id/approve')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '批准资料变更（白名单字段应用到账号并通知申请人）' })
  approveProfileChange(@Param('id') id: string, @CurrentUser('sub') reviewerId: string) {
    return this.service.approveProfileChange(id, reviewerId);
  }

  @Post('admin/profile-change-requests/:id/reject')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '拒绝资料变更（当前资料保持不变并通知申请人）' })
  rejectProfileChange(
    @Param('id') id: string,
    @CurrentUser('sub') reviewerId: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.rejectProfileChange(id, reviewerId, dto.note);
  }
}
