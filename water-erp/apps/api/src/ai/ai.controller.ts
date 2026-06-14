import { Controller, Get, Post, Body, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AiService } from './ai.service';

@ApiTags('AI辅助评标')
@ApiCookieAuth('token')
@Controller('ai')

export class AiController {
  constructor(private aiService: AiService) {}

  @Get('projects/:projectId/analyze/:supplierId')
  @ApiOperation({ summary: 'AI全方位分析供应商投标' })
  @Roles('admin', 'bid_expert', 'bid_host')
  async analyzeBid(
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.aiService.analyzeBid(projectId, supplierId);
  }

  @Get('projects/:projectId/anomalies')
  @ApiOperation({ summary: 'AI评分异常检测' })
  @Roles('admin', 'bid_host', 'procurement_staff')
  async detectAnomalies(@Param('projectId') projectId: string) {
    return this.aiService.detectAnomalies(projectId);
  }

  @Get('projects/:projectId/risk-scores')
  @ApiOperation({ summary: 'AI供应商风险评分' })
  @Roles('admin', 'bid_host', 'procurement_staff')
  async getSupplierRiskScores(@Param('projectId') projectId: string) {
    return this.aiService.getSupplierRiskScores(projectId);
  }

  @Post('supplier-selection')
  @ApiOperation({ summary: 'AI智能推荐供应商（按采购需求）' })
  @Roles('admin', 'procurement_staff', 'bid_host')
  async recommendSuppliers(
    @Body() body: { requirement?: string; classificationId?: string; maxCount?: number },
  ) {
    const requirement = (body?.requirement ?? '').trim();
    if (!requirement) {
      throw new BadRequestException({ error: '请填写采购需求', code: 'REQUIREMENT_REQUIRED' });
    }
    return this.aiService.recommendSuppliers(requirement, {
      classificationId: body.classificationId,
      maxCount: body.maxCount,
    });
  }
}
