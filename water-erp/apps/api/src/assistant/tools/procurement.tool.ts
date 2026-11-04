import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { PROCUREMENT_STATUS_LABEL, t } from './labels';

@Injectable()
export class ProcurementTool implements AssistantTool {
  name = 'procurement';
  description =
    '查询采购台账（立项/轮次）：立项清单/详情/统计/待审批/采购月度趋势（轮次按采购日期计）。采购项目总数请用 global_overview（项目管理口径）。args: { action: "list"|"detail"|"stats"|"pending"|"monthly", status?, projectId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const status = args.status as string | undefined;
    const projectId = args.projectId as string | undefined;
    const limit = (args.limit as number) || 10;
    const companyWhere = toolCompanyWhere(ctx);

    if (action === 'detail' && projectId) {
      const project = await this.prisma.procurementProject.findUnique({
        where: { ...companyWhere, id: projectId },
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
        where: { ...companyWhere, status: 'PENDING_REVIEW' },
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
            title: `台账待审批立项（${pending.length}个）`,
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

    /* 采购月度趋势（2026-11-03 口径审计 F14）：此前全链只有 bid monthly（BidProject
     * 计数）可拿——问「采购趋势/月度采购量」时投标项目数冒充采购趋势。本 action 以
     * 台账轮次 procurementDate（真实采购成交/执行日期）月度计数。 */
    if (action === 'monthly') {
      const rounds = await this.prisma.procurementRound.findMany({
        where: { isRecycled: false, procurementDate: { not: null }, ...companyWhere },
        select: { procurementDate: true },
      });
      const monthMap = new Map<string, number>();
      for (const r of rounds) {
        if (!r.procurementDate) continue; // 防御：where 已滤 not null，双保险
        const m = (r.procurementDate as Date).toISOString().slice(0, 7);
        monthMap.set(m, (monthMap.get(m) ?? 0) + 1);
      }
      const rows = Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([月份, 轮次]) => ({ 月份, 轮次 }));
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '采购月度趋势（台账轮次）',
          columns: [
            { key: '月份', label: '月份' },
            { key: '轮次', label: '轮次' },
          ],
          rows,
          viz: { kind: 'trend', value: '轮次', timeField: '月份' },
        }],
      };
    }

    if (action === 'stats') {
      const byStatus = await this.prisma.procurementProject.groupBy({
        by: ['status'],
        where: { ...companyWhere },
        _count: true,
        _sum: { budget: true },
      });
      byStatus.sort((a, b) => b._count - a._count);
      const procTotal = byStatus.reduce((s, r) => s + r._count, 0);
      return {
        success: true,
        cards: [
          {
            type: 'table',
            title: '台账立项统计',
            columns: [
              { key: 'status', label: '状态' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
              { key: 'budget', label: '预算合计' },
            ],
            rows: byStatus.map((s) => ({
              status: t(PROCUREMENT_STATUS_LABEL, s.status),
              count: s._count,
              pct: procTotal > 0 ? ((s._count / procTotal) * 100).toFixed(1) + '%' : '-',
              budget: s._sum?.budget ? `¥${s._sum.budget}` : '-',
            })),
            viz: { kind: 'distribution', category: 'status', value: 'count' },
          },
        ],
      };
    }

    // default: list
    const where = { ...companyWhere, ...(status ? { status: status as never } : {}) };
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
    // 必须产出 cards：AssistantService.handleNormalChat 只消费 result.cards 构建
    // 第二轮 LLM 上下文，data 字段会被丢弃。若无 cards，真实项目名永远到不了模型，
    // 助手只能拿 global_overview 的汇总数字编宏观散文，点不出具体项目名。
    return {
      success: true,
      data: projects,
      cards: [
        {
          type: 'table',
          title: `台账立项清单（${projects.length}个）`,
          columns: [
            { key: 'projectCode', label: '编号' },
            { key: 'title', label: '名称' },
            { key: 'status', label: '状态' },
            { key: 'budget', label: '预算' },
            { key: 'procurementMethod', label: '采购方式' },
            { key: 'department', label: '部门' },
          ],
          rows: projects.map((p) => ({
            projectCode: p.projectCode,
            title: p.title,
            status: t(PROCUREMENT_STATUS_LABEL, p.status),
            budget: p.budget ? `¥${p.budget}` : '-',
            procurementMethod: p.procurementMethod || '-',
            department: p.department?.name || '-',
          })),
        },
      ],
    };
  }
}
