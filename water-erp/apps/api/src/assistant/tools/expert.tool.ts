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
          { type: 'metric', title: '专家总数', value: String(total) },
          { type: 'metric', title: '可用专家', value: String(available) },
          { type: 'metric', title: '占用中', value: String(busy) },
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
