import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service';
import { ProgressService } from '../../progress/progress.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';

/** 领导驾驶舱（:3011）口径问答——与三页同源（本月口径 + 全量风险），公司口径随 ctx */
@Injectable()
export class CockpitTool implements AssistantTool {
  name = 'cockpit';
  description =
    '查询领导驾驶舱口径数据（本月 + 全量风险）。args: { action: "summary"|"risk"|"savings"|"stages" }——summary=核心指标概览，risk=风险项目，savings=节资排行，stages=采购阶段分布。领导驾驶舱类问题优先用本工具。';

  constructor(
    private readonly dashboard: DashboardService,
    private readonly progress: ProgressService,
  ) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const where = toolCompanyWhere(ctx);
    const action = (args.action as string) || 'summary';
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    if (action === 'stages') {
      const stats = await this.progress.getProgressStats(undefined, undefined, where);
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '采购阶段分布（在办）',
          rows: (stats.stageDistribution ?? []).map((d: { stageName?: string; stage: string; count: number }) => ({
            阶段: d.stageName ?? d.stage, 项目数: d.count,
          })),
        }],
      };
    }

    const data = await this.dashboard.getDashboard(monthStart, undefined, where);
    if (action === 'risk') {
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `风险项目（${data.riskProjects?.length ?? 0} 项）`,
          rows: (data.riskProjects ?? []).map((r: { project: string; pendingDays: number; reason: string }) => ({
            项目: r.project, 滞留天数: r.pendingDays, 原因: r.reason,
          })),
        }],
      };
    }
    if (action === 'savings') {
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '节资率排行',
          rows: (data.savingsRanking ?? []).slice(0, 5).map((s: { project: string; savingsRate: number; savingsLabel: string }) => ({
            项目: s.project, 节资率: `${s.savingsRate}%`, 节约额: s.savingsLabel,
          })),
        }],
      };
    }
    const s = data.summary;
    return {
      success: true,
      cards: [{
        type: 'metric',
        title: '本月驾驶舱概览',
        metrics: [
          { label: '采购轮次', value: String(s.totalCount) },
          { label: '已成交', value: String(s.completedCount) },
          { label: '异常', value: String(s.abnormalCount) },
          { label: '成交总额', value: s.totalAwardLabel },
          { label: '累计节资', value: s.totalSavingsLabel },
        ],
      }],
    };
  }
}
