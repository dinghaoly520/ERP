import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class GlobalOverviewTool implements AssistantTool {
  name = 'global_overview';
  description =
    '获取 ERP 系统全局概览统计，包括采购/招标/供应商/专家/公告数量与状态分布';

  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<ToolResult> {
    const [
      procurementCount,
      bidCount,
      supplierCount,
      expertCount,
      announcementCount,
    ] = await Promise.all([
      this.prisma.procurementProject.count(),
      this.prisma.bidProject.count(),
      this.prisma.supplier.count(),
      this.prisma.expertProfile.count(),
      this.prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
    ]);

    const procurementByStatus =
      await this.prisma.procurementProject.groupBy({
        by: ['status'],
        _count: true,
        _sum: { budget: true },
      });

    const supplierByStatus = await this.prisma.supplier.groupBy({
      by: ['status'],
      _count: true,
    });

    const bidByStage = await this.prisma.bidProject.groupBy({
      by: ['stage'],
      _count: true,
    });

    const expertBySpecialty = await this.prisma.expertProfile.groupBy({
      by: ['specialty'],
      _count: true,
    });

    // Count pending/active items
    const pendingSuppliers = await this.prisma.supplier.count({
      where: { status: 'PENDING' },
    });
    const activeBids = await this.prisma.bidProject.count({
      where: { stage: { in: ['OPENING', 'EVALUATING'] } },
    });

    return {
      success: true,
      cards: [
        { type: 'metric', title: '采购项目总数', value: String(procurementCount) },
        { type: 'metric', title: '招标项目总数', value: String(bidCount) },
        { type: 'metric', title: '在库供应商', value: String(supplierCount) },
        { type: 'metric', title: '评审专家', value: String(expertCount) },
        { type: 'metric', title: '已发布公告', value: String(announcementCount) },
        {
          type: 'metric',
          title: '进行中招标',
          value: String(activeBids),
          trend: '待关注',
        },
        {
          type: 'metric',
          title: '待审核供应商',
          value: String(pendingSuppliers),
          trend: pendingSuppliers > 0 ? '需处理' : '无',
        },
        {
          type: 'table',
          title: '采购项目状态分布',
          columns: [
            { key: 'status', label: '状态' },
            { key: 'count', label: '数量' },
            { key: 'budget', label: '预算合计' },
          ],
          rows: procurementByStatus.map((s) => ({
            status: s.status,
            count: s._count,
            budget: s._sum?.budget ? `¥${s._sum.budget}` : '-',
          })),
        },
        {
          type: 'table',
          title: '招标项目阶段分布',
          columns: [
            { key: 'stage', label: '阶段' },
            { key: 'count', label: '数量' },
          ],
          rows: bidByStage.map((s) => ({ stage: s.stage, count: s._count })),
        },
        {
          type: 'table',
          title: '供应商状态分布',
          columns: [
            { key: 'status', label: '状态' },
            { key: 'count', label: '数量' },
          ],
          rows: supplierByStatus.map((s) => ({
            status: s.status,
            count: s._count,
          })),
        },
        {
          type: 'table',
          title: '专家专业方向分布',
          columns: [
            { key: 'specialty', label: '专业方向' },
            { key: 'count', label: '人数' },
          ],
          rows: expertBySpecialty.map((s) => ({
            specialty: s.specialty,
            count: s._count,
          })),
        },
      ],
    };
  }
}
