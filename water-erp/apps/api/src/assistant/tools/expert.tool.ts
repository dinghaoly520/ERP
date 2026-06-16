import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class ExpertTool implements AssistantTool {
  name = 'expert';
  description =
    '查询专家库统计/列表/专业方向分布/可用状态。args: { action: "stats"|"list"|"by_specialty", specialty?, limit? }';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'stats';
    const specialty = args.specialty as string | undefined;
    const limit = (args.limit as number) || 10;

    if (action === 'by_specialty') {
      const grouped = await this.prisma.expertProfile.groupBy({
        by: ['specialty'],
        _count: true,
      });
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '专家专业方向分布',
          columns: [
            { key: 'specialty', label: '专业方向' },
            { key: 'count', label: '人数' },
          ],
          rows: grouped.map((g) => ({
            specialty: g.specialty,
            count: g._count,
          })),
        }],
      };
    }

    if (action === 'stats') {
      const [total, available, busy] = await Promise.all([
        this.prisma.expertProfile.count(),
        this.prisma.expertProfile.count({ where: { availability: '可用' } }),
        this.prisma.expertProfile.count({ where: { availability: '占用' } }),
      ]);
      const bySpecialty = await this.prisma.expertProfile.groupBy({
        by: ['specialty'], _count: true,
      });
      return {
        success: true,
        cards: [
          {
            type: 'table', title: '专家资源概览',
            columns: [
              { key: 'item', label: '统计项' },
              { key: 'value', label: '数值' },
            ],
            rows: [
              { item: '专家总数', value: total },
              { item: '可用专家', value: available },
              { item: '占用中', value: busy },
            ],
          },
          {
            type: 'table', title: '专业方向分布',
            columns: [
              { key: 'specialty', label: '专业方向' },
              { key: 'count', label: '人数' },
            ],
            rows: bySpecialty.map((s) => ({
              specialty: s.specialty,
              count: s._count,
            })),
            viz: { kind: 'distribution', category: 'specialty', value: 'count' },
          },
        ],
      };
    }

    // list
    const where = specialty ? { specialty } : {};
    const experts = await this.prisma.expertProfile.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, specialty: true, title: true,
        employer: true, availability: true,
        user: { select: { displayName: true } },
      },
    });
    return { success: true, data: experts };
  }
}
