import { Controller, Get, Post, Body, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AiService } from './ai.service';

@ApiTags('AI辅助评标')
@ApiCookieAuth('token')
@Controller('ai')

export class AiController {
  constructor(private aiService: AiService) {}

  @Public()
  @Get('bigscreen-insight')
  @ApiOperation({ summary: '大屏AI分析面板（公开，6格+跑马灯）' })
  async getBigscreenInsight() {
    return this.aiService.getBigscreenInsight();
  }

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

  @Post('dashboard-summary')
  @ApiOperation({ summary: 'AI采购运营总览摘要' })
  @Roles('admin', 'procurement_staff')
  async dashboardSummary(
    @Body() body: {
      supplier?: { total: number; approved: number; pending: number; risk: number };
      announcement?: { total: number; published: number; draftLike: number };
      expert?: { total: number; active: number; unfinished: number };
      catalog?: { total: number; active: number; alerts: number };
      applications?: { pending: number };
    },
  ) {
    return this.aiService.dashboardSummary(body);
  }

  @Post('dashboard-analysis')
  @ApiOperation({ summary: 'AI采购仪表盘深度分析（从procurement迁入）' })
  @Roles('admin', 'procurement_staff')
  async dashboardAnalysis(@Body() payload: any) {
    return this.aiService.analyzeDashboard(payload);
  }

  @Post('procurement-analysis')
  @ApiOperation({ summary: 'AI采购台账分析' })
  @Roles('admin', 'procurement_staff')
  async procurementAnalysis(@Body() payload: any) {
    return this.aiService.analyzeProcurementLedger(payload);
  }

  @Post('tender-field-generate')
  @ApiOperation({ summary: 'AI招标字段内容生成' })
  @Roles('admin', 'procurement_staff', 'bid_host')
  async tenderFieldGenerate(@Body() payload: any) {
    return this.aiService.generateTenderFieldContent(payload);
  }

  @Post('reference-budget')
  @ApiOperation({ summary: 'AI参考预算生成' })
  @Roles('admin', 'procurement_staff')
  async referenceBudget(@Body() payload: any) {
    return this.aiService.generateReferenceBudget(payload);
  }
}
