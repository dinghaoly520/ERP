import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class BidTool implements AssistantTool {
  name = 'bid';
  description =
    '查询招标项目列表/详情/阶段统计/风险项目/进行中项目。args: { action: "list"|"detail"|"stats"|"risks"|"active", stage?, projectId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const stage = args.stage as string | undefined;
    const projectId = args.projectId as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'detail' && projectId) {
      const project = await this.prisma.bidProject.findUnique({
        where: { id: projectId },
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
      const where: any = stageFilter ? { stage: stageFilter } : {};
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
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: action === 'active' ? '进行中的招标项目' : '招标项目风险概览',
            columns: [
              { key: 'projectCode', label: '编号' },
              { key: 'name', label: '名称' },
              { key: 'stage', label: '阶段' },
              { key: 'supplierCount', label: '供应商数' },
              { key: 'riskNote', label: '风险提示' },
            ],
            rows: projects.map((p: any) => ({
              projectCode: p.projectCode,
              name: p.name,
              stage: p.stage,
              supplierCount: p._count.suppliers,
              riskNote: p.riskNote || '无',
            })),
          },
        ],
      };
    }

    if (action === 'stats') {
      const byStage = await this.prisma.bidProject.groupBy({
        by: ['stage'], _count: true,
      });
      return {
        success: true,
        cards: [{
          type: 'table', title: '招标项目阶段分布',
          columns: [{ key: 'stage', label: '阶段' }, { key: 'count', label: '数量' }],
          rows: byStage.map((s) => ({ stage: s.stage, count: s._count })),
        }],
      };
    }

    // default: list
    const where: any = stage ? { stage: stage } : {};
    const projects = await this.prisma.bidProject.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, projectCode: true, name: true, stage: true,
        procurementMethod: true, openTime: true, deadline: true,
        riskNote: true, _count: { select: { suppliers: true } },
      },
    });
    return { success: true, data: projects };
  }
}
