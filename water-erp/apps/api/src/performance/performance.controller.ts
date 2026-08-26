import { Controller, Get, Post, Body, Param, Query, Request, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { PerformanceService } from './performance.service';

/**
 * E1（GB/T 43711 第 9 章）：采购质效评价——:3005 驾驶舱质效卡。
 */
@ApiTags('采购质效')
@Roles('admin', 'leader', 'staff', 'bid_host')
@Controller('performance')
export class PerformanceController {
  constructor(private performanceService: PerformanceService) {}

  @Get('metrics')
  @ApiOperation({ summary: '五项质效指标（9.4 统计分析）' })
  metrics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.performanceService.metrics({ from, to });
  }

  @Post('evaluations')
  @ApiOperation({ summary: '登记项目评分卡（质量/效率/合规，服务端加权）' })
  createEvaluation(@Request() req: any, @Body() dto: any) {
    return this.performanceService.createEvaluation(dto, { userId: req.user.sub, username: req.user.username });
  }

  @Get('evaluations')
  @ApiOperation({ summary: '评分卡列表（可按项目过滤）' })
  listEvaluations(@Query('projectCode') projectCode?: string) {
    return this.performanceService.listEvaluations({ projectCode });
  }

  @Get('satisfactions')
  @ApiOperation({ summary: '供应商满意度反馈列表（9.2）' })
  listSatisfactions(@Query('projectCode') projectCode?: string) {
    return this.performanceService.listSatisfactions({ projectCode });
  }

  @Post('report')
  @ApiOperation({ summary: '生成周期性质效报告 DOCX（9.1/9.4）' })
  generateReport(@Body() dto: { periodLabel?: string }) {
    return this.performanceService.generateReport(dto.periodLabel);
  }
}
