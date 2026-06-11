import { Controller, Get, Post, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AiService } from './ai.service';

@ApiTags('AI辅助评标')
@ApiCookieAuth('token')
@Controller('ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  @Get('projects/:projectId/analyze/:supplierId')
  @ApiOperation({ summary: 'AI全方位分析供应商投标' })
  async analyzeBid(
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.aiService.analyzeBid(projectId, supplierId);
  }

  @Get('projects/:projectId/anomalies')
  @ApiOperation({ summary: 'AI评分异常检测' })
  async detectAnomalies(@Param('projectId') projectId: string) {
    return this.aiService.detectAnomalies(projectId);
  }

  @Get('projects/:projectId/risk-scores')
  @ApiOperation({ summary: 'AI供应商风险评分' })
  async getSupplierRiskScores(@Param('projectId') projectId: string) {
    return this.aiService.getSupplierRiskScores(projectId);
  }
}
