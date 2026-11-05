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

}
