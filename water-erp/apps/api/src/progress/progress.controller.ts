import { Controller, Get, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canViewGlobalBusinessData } from '../auth/auth-scope';
import { ProgressService, ProgressStats } from './progress.service';

@Controller('progress')
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('stats')
  getProgressStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('stage') stage?: string,
  ): Promise<ProgressStats> {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    return this.progressService.getProgressStats(userId, stage);
  }

  @Get('ai-insights')
  getAiInsights(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
    @Query('stage') stage?: string,
  ) {
    if (!canViewGlobalBusinessData(user.role)) {
      throw new ForbiddenException('普通账号无法查看采购进度。');
    }
    return this.progressService.getAiInsights(userId, stage);
  }
}
