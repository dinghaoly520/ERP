import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class MallTool implements AssistantTool {
  name = 'mall';
  description =
    '查询电子商城目录统计/商品列表/预算清单/供货申请。args: { action: "stats"|"list"|"suppliers", category?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'stats';
    const category = args.category as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'stats') {
      const [itemCount, supplierCount, budgetCount, activeSupplierCount] =
        await Promise.all([
          this.prisma.catalogItem.count(),
          this.prisma.catalogSupplier.count({ where: { status: 'ACTIVE' } }),
          this.prisma.budgetList.count({ where: { status: 'ACTIVE' } }),
          this.prisma.catalogSupplier.count({ where: { status: 'ACTIVE' } }),
        ]);

      const byCategory = await this.prisma.catalogItem.groupBy({
        by: ['category'], _count: true,
      });
      byCategory.sort((a, b) => b._count - a._count);
      const mallTotal = byCategory.reduce((s, r) => s + r._count, 0);

      return {
        success: true,
        cards: [
          {
            type: 'table', title: '商城概览',
            columns: [
              { key: 'item', label: '统计项' },
              { key: 'value', label: '数值' },
            ],
            rows: [
              { item: '目录商品数', value: itemCount },
              { item: '活跃供货商', value: activeSupplierCount },
              { item: '活跃预算清单', value: budgetCount },
            ],
          },
          {
            type: 'table', title: '目录类别分布',
            columns: [
              { key: 'category', label: '类别' },
              { key: 'count', label: '数量' },
              { key: 'pct', label: '占比' },
            ],
            rows: byCategory.map((c) => ({
              category: c.category,
              count: c._count,
              pct: mallTotal > 0 ? ((c._count / mallTotal) * 100).toFixed(1) + '%' : '-',
            })),
            viz: { kind: 'distribution', category: 'category', value: 'count' },
          },
        ],
      };
    }

    if (action === 'suppliers') {
      const suppliers = await this.prisma.catalogSupplier.findMany({
        where: { status: 'ACTIVE' },
        take: limit,
        select: {
          id: true,
          quotedPrice: true,
          region: true,
          supplier: { select: { name: true } },
          catalogItem: { select: { name: true, category: true } },
        },
      });
      return { success: true, data: suppliers };
    }

    // list
    const where = category ? { category } : {};
    const items = await this.prisma.catalogItem.findMany({
      where: where as never,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, code: true, name: true, category: true,
        referencePrice: true, unit: true, supplier: true,
        status: true,
      },
    });
    return { success: true, data: items };
  }
}
