import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { STAGE_LABEL, t } from './labels';

@Injectable()
export class BidTool implements AssistantTool {
  name = 'bid';
  description =
    '查询投标项目（开评标执行）列表/详情/阶段统计/月度趋势/风险项目/进行中项目。注意：本工具的阶段=投标执行阶段（文件下载/加密投递/开标/评标/归档）；采购流程阶段（采购文件→合同）请用 cockpit 或 global_overview；采购活动的月度量请用 procurement。args: { action: "list"|"detail"|"stats"|"monthly"|"risks"|"active", stage?, projectId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const stage = args.stage as string | undefined;
    const projectId = args.projectId as string | undefined;
    const limit = (args.limit as number) || 10;
    const companyWhere = toolCompanyWhere(ctx);

    if (action === 'detail' && projectId) {
      const project = await this.prisma.bidProject.findUnique({
        where: { ...companyWhere, id: projectId },
        include: {
          suppliers: { select: { id: true, supplierName: true, submitStatus: true, decryptStatus: true } },
          experts: { select: { id: true, expertName: true, major: true, progress: true } },
          _count: { select: { scoreItems: true, supervisionLogs: true } },
        },
      });
      if (!project) return { success: false, error: '项目不存在' };
      return { success: true, data: project };
    }

    if (action === 'risks' || action === 'active') {
      const stageFilter: any =
        action === 'active'
          ? { in: ['OPENING', 'EVALUATING'] }
          : undefined;
      const where: any = stageFilter
        ? { ...companyWhere, stage: stageFilter, isExtractionOnly: false }
        : { ...companyWhere, isExtractionOnly: false };
      const projects = await this.prisma.bidProject.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, projectCode: true, name: true, stage: true,
          riskNote: true, openTime: true, deadline: true,
          _count: { select: { suppliers: true, experts: true } },
        },
      });
      /* risks 动作真滤风险（2026-11-04 审查 P2-16）：此前是「最近创建清单」冒充
       * 风险概览（riskNote 空照进、显示「无」）——只留 riskNote 非空或已超截止期 */
      const filtered = action === 'risks'
        ? projects.filter((p: any) => (p.riskNote && String(p.riskNote).trim()) || (p.deadline && new Date(p.deadline) < new Date()))
        : projects;
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: action === 'active' ? '进行中的投标项目' : `投标项目风险概览（${filtered.length} 项）`,
            columns: [
              { key: 'projectCode', label: '编号' },
              { key: 'name', label: '名称' },
              { key: 'stage', label: '阶段' },
              { key: 'supplierCount', label: '供应商数' },
              { key: 'riskNote', label: '风险提示' },
            ],
            rows: filtered.map((p: any) => ({
              projectCode: p.projectCode,
              name: p.name,
              stage: t(STAGE_LABEL, p.stage),
              supplierCount: p._count.suppliers,
              riskNote: p.riskNote || (p.deadline && new Date(p.deadline) < new Date() ? '已超截止期' : '无'),
            })),
          },
        ],
      };
    }

    if (action === 'monthly') {
      // Get projects grouped by month for trend chart
      const projects = await this.prisma.bidProject.findMany({
        where: { ...companyWhere, isExtractionOnly: false },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const monthMap = new Map<string, number>();
      for (const p of projects) {
        const key = p.createdAt.toISOString().slice(0, 7); // YYYY-MM
        monthMap.set(key, (monthMap.get(key) || 0) + 1);
      }
      const rows = Array.from(monthMap.entries()).map(([month, count]) => ({ month, count }));
      rows.sort((a, b) => a.month.localeCompare(b.month));
      return {
        success: true,
        cards: [{
          type: 'table', title: '月度投标项目数量趋势',
          columns: [
            { key: 'month', label: '月份' },
            { key: 'count', label: '数量' },
          ],
          rows,
          viz: { kind: 'trend', value: 'count', timeField: 'month' },
        }],
      };
    }

    if (action === 'stats') {
      const byStage = await this.prisma.bidProject.groupBy({
        by: ['stage'], where: { ...companyWhere, isExtractionOnly: false }, _count: true,
      });
      byStage.sort((a, b) => b._count - a._count);
      const bidTotal = byStage.reduce((s, r) => s + r._count, 0);
      return {
        success: true,
        cards: [{
          /* 2026-11-03 用户裁定：采购语境不称「招标」——本卡只在投标/开评标类提问出现，
             标题改「投标项目阶段分布」与采购阶段（PMI）区分 */
          type: 'table', title: '投标项目阶段分布',
          columns: [
            { key: 'stage', label: '阶段' },
            { key: 'count', label: '数量' },
            { key: 'pct', label: '占比' },
          ],
          rows: byStage.map((s) => ({
            stage: t(STAGE_LABEL, s.stage),
            count: s._count,
            pct: bidTotal > 0 ? ((s._count / bidTotal) * 100).toFixed(1) + '%' : '-',
          })),
          viz: { kind: 'distribution', category: 'stage', value: 'count' },
        }],
      };
    }

    // default: list
    const where: any = stage
      ? { ...companyWhere, stage: stage, isExtractionOnly: false }
      : { ...companyWhere, isExtractionOnly: false };
    const projects = await this.prisma.bidProject.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, projectCode: true, name: true, stage: true,
        procurementMethod: true, openTime: true, deadline: true,
        riskNote: true, _count: { select: { suppliers: true } },
      },
    });
    // 必须产出 cards：AssistantService.handleNormalChat 只消费 result.cards，data 会被丢弃。
    // 无 cards 则真实投标项目名到不了第二轮 LLM，助手只能拿汇总数字写宏观散文。
    return {
      success: true,
      data: projects,
      cards: [
        {
          type: 'table',
          title: `投标项目清单（${projects.length}个）`,
          columns: [
            { key: 'projectCode', label: '编号' },
            { key: 'name', label: '名称' },
            { key: 'stage', label: '阶段' },
            { key: 'procurementMethod', label: '采购方式' },
            { key: 'supplierCount', label: '供应商数' },
          ],
          rows: projects.map((p: any) => ({
            projectCode: p.projectCode,
            name: p.name,
            stage: t(STAGE_LABEL, p.stage),
            procurementMethod: p.procurementMethod || '-',
            supplierCount: p._count?.suppliers ?? 0,
          })),
        },
      ],
    };
  }
}
