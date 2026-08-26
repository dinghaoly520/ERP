import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkflowService } from './workflow.service';

/**
 * C1 统一流程中心（:3005「流程中心」页数据源）。
 * 只读聚合，各审批的处理仍在原端点/原页面进行。
 */
@Controller('workflow')
@Roles('staff', 'leader', 'admin')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  /** 待我审批（按登录角色过滤 admin 专属源） */
  @Get('pending')
  pending(@CurrentUser('role') role: string) {
    return this.workflow.pending(role);
  }

  /** 我发起的申请（含在途与已办） */
  @Get('mine')
  mine(@CurrentUser('sub') userId: string) {
    return this.workflow.mine(userId);
  }

  /** 最近已办（默认 20 条） */
  @Get('done')
  done(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.workflow.done(n);
  }
}
