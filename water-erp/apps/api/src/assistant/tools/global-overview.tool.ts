import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';
import {
  PROCUREMENT_STATUS_LABEL,
  STAGE_LABEL,
  SUPPLIER_STATUS_LABEL,
  t,
} from './labels';

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
        {
          type: 'table',
          title: '全局概览统计',
          columns: [
            { key: 'item', label: '统计项' },
            { key: 'value', label: '数值' },
            { key: 'note', label: '备注' },
          ],
          rows: [
            { item: '采购项目', value: procurementCount, note: '全部状态' },
            { item: '招标项目', value: bidCount, note: `其中 ${activeBids} 个进行中` },
            { item: '在库供应商', value: supplierCount, note: `其中 ${pendingSuppliers} 家待审核` },
            { item: '评审专家', value: expertCount, note: '全专业方向' },
            { item: '已发布公告', value: announcementCount, note: '当前在线' },
          ],
        },
        {
          type: 'table',
          title: '采购项目状态分布',
          columns: [
            { key: 'status', label: '状态' },
            { key: 'count', label: '数量' },
            { key: 'pct', label: '占比' },
            { key: 'budget', label: '预算合计' },
          ],
          rows: (() => {
            procurementByStatus.sort((a, b) => b._count - a._count);
            const procurementTotal = procurementByStatus.reduce((s, r) => s + r._count, 0);
            return procurementByStatus.map((s) => ({
              status: t(PROCUREMENT_STATUS_LABEL, s.status),
              count: s._count,
              pct: procurementTotal > 0 ? ((s._count / procurementTotal) * 100).toFixed(1) + '%' : '-',
              budget: s._sum?.budget ? `¥${s._sum.budget}` : '-',
            }));
          })(),
          viz: { kind: 'distribution', category: 'status', value: 'count' },
        },
        {
          type: 'table',
          title: '招标项目阶段分布',
          columns: [
            { key: 'stage', label: '阶段' },
            { key: 'count', label: '数量' },
            { key: 'pct', label: '占比' },
          ],
          rows: (() => {
            bidByStage.sort((a, b) => b._count - a._count);
            const bidTotal = bidByStage.reduce((s, r) => s + r._count, 0);
            return bidByStage.map((s) => ({
              stage: t(STAGE_LABEL, s.stage),
              count: s._count,
              pct: bidTotal > 0 ? ((s._count / bidTotal) * 100).toFixed(1) + '%' : '-',
            }));
          })(),
          viz: { kind: 'distribution', category: 'stage', value: 'count' },
        },
        {
          type: 'table',
          title: '供应商状态分布',
          columns: [
            { key: 'status', label: '状态' },
            { key: 'count', label: '数量' },
            { key: 'pct', label: '占比' },
          ],
          rows: (() => {
            supplierByStatus.sort((a, b) => b._count - a._count);
            const supplierTotal = supplierByStatus.reduce((s, r) => s + r._count, 0);
            return supplierByStatus.map((s) => ({
              status: t(SUPPLIER_STATUS_LABEL, s.status),
              count: s._count,
              pct: supplierTotal > 0 ? ((s._count / supplierTotal) * 100).toFixed(1) + '%' : '-',
            }));
          })(),
          viz: { kind: 'distribution', category: 'status', value: 'count' },
        },
        {
          type: 'table',
          title: '专家专业方向分布',
          columns: [
            { key: 'specialty', label: '专业方向' },
            { key: 'count', label: '人数' },
            { key: 'pct', label: '占比' },
          ],
          rows: (() => {
            expertBySpecialty.sort((a, b) => b._count - a._count);
            const expertTotal = expertBySpecialty.reduce((s, r) => s + r._count, 0);
            return expertBySpecialty.map((s) => ({
              specialty: s.specialty,
              count: s._count,
              pct: expertTotal > 0 ? ((s._count / expertTotal) * 100).toFixed(1) + '%' : '-',
            }));
          })(),
          viz: { kind: 'distribution', category: 'specialty', value: 'count' },
        },
      ],
    };
  }
}
