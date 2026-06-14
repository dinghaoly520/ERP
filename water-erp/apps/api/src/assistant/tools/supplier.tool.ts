import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class SupplierTool implements AssistantTool {
  name = 'supplier';
  description =
    '查询供应商列表/详情/状态统计/风险画像/待审核项。args: { action: "list"|"detail"|"stats"|"pending"|"risk", status?, supplierId?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const status = args.status as string | undefined;
    const supplierId = args.supplierId as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'detail' && supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        include: {
          classification: { select: { name: true } },
          contacts: { select: { name: true, phone: true, email: true, isPrimary: true } },
          _count: { select: { evaluations: true, bidSuppliers: true, changeRecords: true } },
        },
      });
      if (!supplier) return { success: false, error: '供应商不存在' };
      return { success: true, data: supplier };
    }

    if (action === 'pending') {
      const pending = await this.prisma.supplier.findMany({
        where: { status: 'PENDING' },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, enterpriseType: true,
          creditCode: true, createdAt: true,
          classification: { select: { name: true } },
        },
      });
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `待审核供应商（${pending.length}个）`,
          columns: [
            { key: 'name', label: '名称' },
            { key: 'enterpriseType', label: '企业类型' },
            { key: 'classification', label: '分类' },
            { key: 'creditCode', label: '信用代码' },
          ],
          rows: pending.map((s) => ({
            name: s.name,
            enterpriseType: s.enterpriseType,
            classification: s.classification?.name || '-',
            creditCode: s.creditCode || '-',
          })),
        }],
        data: pending,
      };
    }

    if (action === 'risk') {
      // Risk: disabled, blacklisted, or suppliers with no evaluations
      const risky = await this.prisma.supplier.findMany({
        where: { status: { in: ['DISABLED', 'BLACKLIST'] } },
        take: limit,
        select: { id: true, name: true, status: true, enterpriseType: true },
      });
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `风险供应商（${risky.length}个）`,
          columns: [
            { key: 'name', label: '名称' },
            { key: 'status', label: '状态' },
            { key: 'enterpriseType', label: '类型' },
          ],
          rows: risky.map((s) => ({ name: s.name, status: s.status, enterpriseType: s.enterpriseType })),
        }],
      };
    }

    if (action === 'stats') {
      const byStatus = await this.prisma.supplier.groupBy({
        by: ['status'], _count: true,
      });
      return {
        success: true,
        cards: [{
          type: 'table', title: '供应商状态分布',
          columns: [{ key: 'status', label: '状态' }, { key: 'count', label: '数量' }],
          rows: byStatus.map((s) => ({ status: s.status, count: s._count })),
        }],
      };
    }

    // default: list
    const where = status ? { status: status as never } : {};
    const suppliers = await this.prisma.supplier.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, enterpriseType: true, status: true,
        legalPerson: true, createdAt: true,
        classification: { select: { name: true } },
      },
    });
    return { success: true, data: suppliers };
  }
}
