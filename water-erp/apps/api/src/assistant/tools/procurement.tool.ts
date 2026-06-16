import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';
import { PROCUREMENT_STATUS_LABEL, t } from './labels';

@Injectable()
export class ProcurementTool implements AssistantTool {
  name = 'procurement';
  description =
    '查询采购项目列表/详情/统计/待审批项。args: { action: "list"|"detail"|"stats"|"pending", status?, projectId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const status = args.status as string | undefined;
    const projectId = args.projectId as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'detail' && projectId) {
      const project = await this.prisma.procurementProject.findUnique({
        where: { id: projectId },
        include: {
          department: { select: { name: true } },
          bidProject: {
            select: { projectCode: true, name: true, stage: true },
          },
          creator: { select: { displayName: true } },
        },
      });
      if (!project) return { success: false, error: '项目不存在' };
      return { success: true, data: project };
    }

    if (action === 'pending') {
      const pending = await this.prisma.procurementProject.findMany({
        where: { status: 'PENDING_REVIEW' },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          projectCode: true,
          budget: true,
          procurementType: true,
          procurementMethod: true,
          createdAt: true,
          department: { select: { name: true } },
        },
      });
      return {
        success: true,
        data: pending,
        cards: [
          {
            type: 'table',
            title: `待审批项目（${pending.length}个）`,
            columns: [
              { key: 'projectCode', label: '编号' },
              { key: 'title', label: '名称' },
              { key: 'budget', label: '预算' },
              { key: 'procurementType', label: '类型' },
              { key: 'department', label: '部门' },
            ],
            rows: pending.map((p) => ({
              projectCode: p.projectCode,
              title: p.title,
              budget: p.budget ? `¥${p.budget}` : '-',
              procurementType: p.procurementType,
              department: p.department?.name || '-',
            })),
          },
        ],
      };
    }

    if (action === 'stats') {
      const byStatus = await this.prisma.procurementProject.groupBy({
        by: ['status'],
        _count: true,
        _sum: { budget: true },
      });
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '采购项目统计',
            columns: [
              { key: 'status', label: '状态' },
              { key: 'count', label: '数量' },
              { key: 'budget', label: '预算合计' },
            ],
            rows: byStatus.map((s) => ({
              status: t(PROCUREMENT_STATUS_LABEL, s.status),
              count: s._count,
              budget: s._sum?.budget ? `¥${s._sum.budget}` : '-',
            })),
            viz: { kind: 'distribution', category: 'status', value: 'count' },
          },
        ],
      };
    }

    // default: list
    const where = status ? { status: status as never } : {};
    const projects = await this.prisma.procurementProject.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        projectCode: true,
        status: true,
        budget: true,
        procurementType: true,
        procurementMethod: true,
        createdAt: true,
        department: { select: { name: true } },
      },
    });
    return { success: true, data: projects };
  }
}
