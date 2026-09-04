import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from './current-user.decorator';
import { PasswordRequestsService } from './password-requests.service';
import { RejectDto } from './password-requests.controller';

/**
 * 供应商密码重置审批（2026-09-03）：供应商账号的重置申请归 :3005 供应商管理中心审批
 * （staff/leader 日常处理），不再进 admin 账号管理·安全审批（那边只留内部账号口径）。
 * 与 supplier 模块同权限面（admin/leader/staff）。
 */
@ApiTags('供应商管理')
@Controller('supplier/password-reset-requests')
export class SupplierPasswordResetController {
  constructor(private readonly service: PasswordRequestsService) {}

  @Get()
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '待审批的供应商密码重置申请（仅匹配到供应商账号的）' })
  list() {
    return this.service.listPendingResets('supplier');
  }

  @Post(':id/approve')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '批准供应商密码重置（按申请提交的新密码生效）' })
  approve(@Param('id') id: string, @CurrentUser('sub') reviewerId: string) {
    return this.service.approveReset(id, reviewerId, 'supplier');
  }

  @Post(':id/reject')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '拒绝供应商密码重置申请' })
  reject(
    @Param('id') id: string,
    @CurrentUser('sub') reviewerId: string,
    @Body() dto: RejectDto,
  ) {
    return this.service.rejectReset(id, reviewerId, dto.decisionNote, 'supplier');
  }
}
