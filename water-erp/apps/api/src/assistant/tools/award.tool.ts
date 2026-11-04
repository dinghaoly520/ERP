import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { STAGE_LABEL, t } from './labels';

function formatWan(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '-';
  return `${(n / 10000).toFixed(1)}万`;
}

/**
 * 成交结果工具（2026-11-04 数据广度补齐）：BidEvaluationResult=评标定标产物
 * （排名/总分/报价/推荐/废标）——「谁中标、成交额多少、第几名、比别家便宜多少」
 * 此前只有台账轮次的汇总金额，项目级点名不可查。金额口径：bidPrice=元。
 */
@Injectable()
export class AwardTool implements AssistantTool {
  name = 'award';
  description =
    '查询项目成交结果（评标定标明细：供应商排名/总分/报价/推荐中标/废标）。args: { action: "by_project"|"recent", keyword?, projectId?, limit? }——by_project 按项目名关键词查该项目全部供应商的评审排名（keyword 支持项目名简写），recent=最近生成的成交结果。问「谁中标/成交多少钱/排名」用本工具。';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'recent';
    const keyword = (args.keyword as string) || (args.projectName as string) || undefined;
    const projectId = args.projectId as string | undefined;
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
    const companyWhere = toolCompanyWhere(ctx);

    if (action === 'by_project') {
      if (!keyword && !projectId) {
        return { success: false, error: '请提供项目名关键词（keyword）或 projectId' };
      }
      const project = await this.prisma.bidProject.findFirst({
        where: {
          ...(projectId ? { id: projectId } : {}),
          ...(keyword ? { name: { contains: keyword } } : {}),
          ...companyWhere,
          isExtractionOnly: false,
        },
        select: { id: true, name: true, projectCode: true, stage: true },
      });
      if (!project) return { success: false, error: '未找到匹配的项目' };
      const results = await this.prisma.bidEvaluationResult.findMany({
        where: { projectId: project.id },
        orderBy: { rank: 'asc' },
      });
      if (results.length === 0) {
        return {
          success: true,
          cards: [{
            type: 'metric',
            title: `${project.name}·成交结果`,
            metrics: [{ label: '状态', value: '尚未生成评标结果' }],
          }],
        };
      }
      const prices = results.filter((r) => !r.disqualified && r.bidPrice != null).map((r) => Number(r.bidPrice));
      const minPrice = prices.length ? Math.min(...prices) : null;
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: `${project.name}·评审排名与报价`,
            columns: [
              { key: 'rank', label: '排名' },
              { key: 'supplier', label: '供应商' },
              { key: 'score', label: '平均分' },
              { key: 'price', label: '报价' },
              { key: 'note', label: '备注' },
            ],
            viz: { kind: 'ranking', category: 'supplier', value: 'scoreNum' },
            rows: results.map((r) => ({
              rank: r.disqualified ? '-' : r.rank,
              supplier: r.supplierName,
              score: r.averageScore != null ? Number(r.averageScore).toFixed(2) : '-',
              scoreNum: r.averageScore != null ? Number(r.averageScore) : 0,
              price: r.bidPrice != null ? formatWan(r.bidPrice) : '-',
              note: r.disqualified ? '废标' : r.recommended ? '推荐中标' : '-',
            })),
          },
          ...(minPrice != null
            ? [{
                type: 'metric' as const,
                title: `${project.name}·价格对比`,
                metrics: [
                  { label: '最低报价', value: formatWan(minPrice) },
                  { label: '报价家数', value: String(prices.length) },
                ],
              }]
            : []),
        ],
        data: { note: '报价口径为元（评标结果侧）；开标记录侧为万元——本卡已统一按万元展示。' },
      };
    }

    // default: recent（最近成交结果——按生成时间倒序，行=项目×推荐中标人）
    /* 结果表无 companyId——公司口径穿 project 关系（轮次/项目表才有归属） */
    const results = await this.prisma.bidEvaluationResult.findMany({
      where: { recommended: true, project: { ...companyWhere, isExtractionOnly: false } },
      orderBy: { generatedAt: 'desc' },
      take: limit,
      include: { project: { select: { name: true, projectCode: true, stage: true } } },
    });
    if (results.length === 0) {
      return {
        success: true,
        cards: [{
          type: 'metric',
          title: '成交结果',
          metrics: [{ label: '状态', value: '暂无已定标项目' }],
        }],
      };
    }
    return {
      success: true,
      cards: [
        {
          type: 'table',
          title: `最近成交结果（${results.length} 项）`,
          columns: [
            { key: 'project', label: '项目' },
            { key: 'supplier', label: '成交供应商' },
            { key: 'score', label: '平均分' },
            { key: 'price', label: '成交报价' },
            { key: 'stage', label: '项目阶段' },
          ],
          rows: results.map((r) => ({
            project: r.project?.name ?? '-',
            supplier: r.supplierName,
            score: r.averageScore != null ? Number(r.averageScore).toFixed(2) : '-',
            price: r.bidPrice != null ? formatWan(r.bidPrice) : '-',
            stage: t(STAGE_LABEL, r.project?.stage),
          })),
        },
      ],
    };
  }
}
