import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AiService } from './ai.service';
import { SupplierEvaluationAnalysisService } from './supplier-evaluation-analysis.service';
import { SupplierPortraitAnalysisService } from './supplier-portrait-analysis.service';
import { ShareShortlistDto } from './dto/share-shortlist.dto';

@ApiTags('AI辅助评标')
@ApiCookieAuth('token')
@Controller('ai')

export class AiController {
  constructor(
    private aiService: AiService,
    private supplierEvalAnalysis: SupplierEvaluationAnalysisService,
    private supplierPortraitAnalysis: SupplierPortraitAnalysisService,
  ) {}

  @Public()
  @Get('bigscreen-insight')
  @ApiOperation({ summary: '大屏AI分析面板（公开，6格+跑马灯）' })
  async getBigscreenInsight() {
    return this.aiService.getBigscreenInsight();
  }

  @Get('projects/:projectId/analyze/:supplierId')
  @ApiOperation({ summary: 'AI全方位分析供应商投标' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async analyzeBid(
    @Param('projectId') projectId: string,
    @Param('supplierId') supplierId: string,
  ) {
    return this.aiService.analyzeBid(projectId, supplierId);
  }

  @Get('projects/:projectId/anomalies')
  @ApiOperation({ summary: 'AI评分异常检测' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async detectAnomalies(@Param('projectId') projectId: string) {
    return this.aiService.detectAnomalies(projectId);
  }

  @Get('projects/:projectId/risk-scores')
  @ApiOperation({ summary: 'AI供应商风险评分' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async getSupplierRiskScores(@Param('projectId') projectId: string) {
    return this.aiService.getSupplierRiskScores(projectId);
  }

  @Post('supplier-selection')
  @ApiOperation({ summary: 'AI智能推荐供应商（按采购需求）' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async recommendSuppliers(
    @Body() body: { requirement?: string; classificationId?: string; maxCount?: number },
  ) {
    const requirement = (body?.requirement ?? '').trim();
    if (!requirement) {
      throw new BadRequestException({ error: '请填写采购需求', code: 'REQUIREMENT_REQUIRED' });
    }
    try {
      return await this.aiService.recommendSuppliers(requirement, {
        classificationId: body.classificationId,
        maxCount: body.maxCount,
      });
    } catch (e: any) {
      throw new BadRequestException({ error: e?.message || '智能推荐服务暂时不可用，请稍后重试', code: 'RECOMMEND_FAILED' });
    }
  }

  @Post('dashboard-summary')
  @ApiOperation({ summary: 'AI采购运营总览摘要' })
  @Roles('admin', 'leader', 'staff')
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

  @Get('ai-calibration')
  @ApiOperation({ summary: 'P1-E：全局 AI 评分校准（跨项目采纳率 + category 偏差）' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  getAiCalibration() { return this.aiService.getAiCalibration(); }

  @Post('dashboard-analysis')
  @ApiOperation({ summary: 'AI采购仪表盘深度分析（从procurement迁入）' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async dashboardAnalysis(@Body() payload: any) {
    return this.aiService.analyzeDashboard(payload);
  }

  @Post('procurement-analysis')
  @ApiOperation({ summary: 'AI采购台账分析' })
  @Roles('admin', 'leader', 'staff')
  async procurementAnalysis(@Body() payload: any) {
    return this.aiService.analyzeProcurementLedger(payload);
  }

  @Post('tender-field-generate')
  @ApiOperation({ summary: 'AI招标字段内容生成' })
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async tenderFieldGenerate(@Body() payload: any) {
    return this.aiService.generateTenderFieldContent(payload);
  }

  @Post('reference-budget')
  @ApiOperation({ summary: 'AI参考预算生成' })
  @Roles('admin', 'leader', 'staff')
  async referenceBudget(@Body() payload: any) {
    return this.aiService.generateReferenceBudget(payload);
  }

  @Post('generate-notification')
  @ApiOperation({ summary: 'AI生成供应商通知文案' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async generateNotificationContent(
    @Body() payload: { projectName?: string; projectCode?: string; supplierNames: string[] },
  ) {
    return this.aiService.generateNotificationContent(payload);
  }

  @Post('polish-requirement')
  @ApiOperation({ summary: 'AI润色采购需求描述' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async polishRequirement(@Body() payload: { text: string; projectName?: string; procurementMethod?: string; deadline?: string; additionalContext?: string }) {
    if (!payload.text?.trim()) throw new BadRequestException('请提供需求文本');
    return this.aiService.polishRequirement(payload.text.trim(), {
      projectName: payload.projectName,
      procurementMethod: payload.procurementMethod,
      deadline: payload.deadline,
      additionalContext: payload.additionalContext,
    });
  }

  @Post('polish-initiation-field')
  @ApiOperation({ summary: 'AI优化立项事由/供方要求（基于上传的需求表与立项表）' })
  @Roles('admin', 'leader', 'staff')
  async polishInitiationField(@Body() payload: {
    field: 'projectReason' | 'supplierRequirements';
    text: string;
    demandDocText?: string;
    initiationDocText?: string;
    projectContext?: { title?: string; category?: string; method?: string };
  }) {
    if (!payload.text?.trim()) throw new BadRequestException('请提供待优化的文本');
    if (payload.field !== 'projectReason' && payload.field !== 'supplierRequirements') {
      throw new BadRequestException('field 必须是 projectReason 或 supplierRequirements');
    }
    return this.aiService.polishInitiationField({
      field: payload.field,
      text: payload.text.trim(),
      demandDocText: payload.demandDocText,
      initiationDocText: payload.initiationDocText,
      projectContext: payload.projectContext,
    });
  }

  @Post('supplier-evaluation-analysis')
  @ApiOperation({ summary: 'AI供应商评价维度分析' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async supplierEvaluationAnalysis(@Body() payload: { supplierId: string }) {
    if (!payload.supplierId) throw new BadRequestException('请提供 supplierId');
    return this.supplierEvalAnalysis.analyze(payload.supplierId);
  }

  @Post('supplier-portrait-analysis')
  @ApiOperation({ summary: 'AI供应商综合画像分析' })
  @Roles('admin', 'bid_expert', 'leader', 'staff')
  async getSupplierPortraitAnalysis(@Body() payload: { supplierId: string }) {
    if (!payload.supplierId) throw new BadRequestException('请提供 supplierId');
    return this.supplierPortraitAnalysis.analyze(payload.supplierId);
  }

  // ── C8 履约违约风险预测 ──
  @Get('supplier-default-risk')
  @ApiOperation({ summary: '供应商履约违约风险预测（规则+诚实置信度）' })
  @Roles('admin', 'leader', 'staff')
  async predictDefaultRisk(@Query('supplierId') supplierId: string) {
    if (!supplierId) throw new BadRequestException('请提供 supplierId');
    return this.aiService.predictSupplierDefaultRisk(supplierId);
  }

  // ── A2 选取历史 / 候选名单 / 分享（此前路由缺失致前端死链）──
  @Get('selection-history')
  @ApiOperation({ summary: '选取历史列表' })
  @Roles('admin', 'leader', 'staff')
  async listSelectionHistory() { return this.aiService.listSelectionHistory(); }

  @Get('selection-history/:id')
  @ApiOperation({ summary: '选取历史详情' })
  @Roles('admin', 'leader', 'staff')
  async getSelectionHistory(@Param('id') id: string) { return this.aiService.getSelectionHistoryDetail(id); }

  @Get('selection-history/:id/shortlist')
  @ApiOperation({ summary: '恢复候选名单（返回该次推荐）' })
  @Roles('admin', 'leader', 'staff')
  async getSelectionShortlist(@Param('id') id: string) { return this.aiService.getSelectionHistoryShortlist(id); }

  @Patch('selection-history/:id/shortlist')
  @ApiOperation({ summary: '更新候选名单勾选' })
  @Roles('admin', 'leader', 'staff')
  async updateSelectionShortlist(@Param('id') id: string, @Body() body: { shortlistedIds: string[] }) {
    return this.aiService.updateSelectionShortlist(id, body?.shortlistedIds ?? []);
  }

  @Delete('selection-history/:id')
  @ApiOperation({ summary: '删除选取历史' })
  @Roles('admin', 'leader', 'staff')
  async deleteSelectionHistory(@Param('id') id: string) { return this.aiService.deleteSelectionHistory(id); }

  @Post('share-shortlist')
  @ApiOperation({ summary: '分享候选名单给采购主管' })
  @Roles('admin', 'leader', 'staff')
  async shareShortlist(@Body() body: ShareShortlistDto) {
    return this.aiService.shareShortlist(body);
  }
}
