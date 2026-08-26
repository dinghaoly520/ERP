import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../common/decorators/roles.decorator';
import { PmiOwnershipGuard } from '../project-management/pmi-ownership.guard';
import { ReviewSubmissionDto } from '../project-management/dto/review-submission.dto';
import { ProjectPlanService } from './project-plan.service';
import { CreatePlanItemDto } from './dto/create-plan-item.dto';
import { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import { CreateTeamMemberDto, UpdateTeamMemberDto } from './dto/team-member.dto';

@Roles('leader', 'admin', 'staff')
@UseGuards(PmiOwnershipGuard) // 个人隔离同项目管理；/review 端点对 leader 放行（守卫注释）
@Controller('project-plan')
export class ProjectPlanController {
  constructor(private readonly projectPlanService: ProjectPlanService) {}

  // A-47 任务计划条目
  @Get(':id/plans')
  listPlans(@Param('id') id: string) {
    return this.projectPlanService.listPlans(id);
  }

  @Post(':id/plans')
  createPlan(@Param('id') id: string, @Body() dto: CreatePlanItemDto) {
    return this.projectPlanService.createPlan(id, dto);
  }

  @Patch(':id/plans/:planId')
  updatePlan(@Param('id') id: string, @Param('planId') planId: string, @Body() dto: UpdatePlanItemDto) {
    return this.projectPlanService.updatePlan(id, planId, dto);
  }

  @Delete(':id/plans/:planId')
  deletePlan(@Param('id') id: string, @Param('planId') planId: string) {
    return this.projectPlanService.deletePlan(id, planId);
  }

  // A-49 计划报审/受理（整包）
  @Post(':id/plans/submit')
  submitPlans(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.projectPlanService.submitPlans(id, user);
  }

  @Post(':id/plans/review')
  reviewPlans(
    @Param('id') id: string,
    @Body() dto: ReviewSubmissionDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.projectPlanService.reviewPlans(id, dto, user);
  }

  // A-48 项目团队
  @Get('users')
  listCandidateUsers() {
    return this.projectPlanService.listCandidateUsers();
  }

  @Get(':id/team')
  listTeam(@Param('id') id: string) {
    return this.projectPlanService.listTeam(id);
  }

  @Post(':id/team')
  addTeamMember(@Param('id') id: string, @Body() dto: CreateTeamMemberDto) {
    return this.projectPlanService.addTeamMember(id, dto);
  }

  @Patch(':id/team/:memberId')
  updateTeamMember(@Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: UpdateTeamMemberDto) {
    return this.projectPlanService.updateTeamMember(id, memberId, dto);
  }

  @Delete(':id/team/:memberId')
  removeTeamMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    return this.projectPlanService.removeTeamMember(id, memberId);
  }
}
