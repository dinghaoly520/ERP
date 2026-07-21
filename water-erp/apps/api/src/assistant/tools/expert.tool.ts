import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, ToolResult } from './assistant-tool';

@Injectable()
export class ExpertTool implements AssistantTool {
  name = 'expert';
  description =
    '查询专家库统计/列表/专业方向分布/可用状态/条件检索专家。args: { action: "stats"|"list"|"by_specialty"|"search", specialty?, title?, employer?, keyword?, availability?, limit? }。用户用自然语言找专家（如"找3个做过水利的高工"）时，用 action:"search"，把专业填 specialty、职称填 title、单位填 employer、姓名填 keyword、可用状态填 availability。';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}): Promise<ToolResult> {
    const action = (args.action as string) || 'stats';
    const specialty = args.specialty as string | undefined;
    const limit = (args.limit as number) || 10;

    // 条件检索（自然语言查专家库的落点）：各条件可组合，contains 模糊匹配
    if (action === 'search') {
      const kw = args.keyword as string | undefined;
      const title = args.title as string | undefined;
      const employer = args.employer as string | undefined;
      const availability = args.availability as string | undefined;
      const where: Record<string, unknown> = {};
      if (specialty) where.specialty = { contains: specialty };
      if (title) where.title = { contains: title };
      if (employer) where.employer = { contains: employer };
      if (availability) where.availability = availability;
      if (kw) where.user = { displayName: { contains: kw } };
      const experts = await this.prisma.expertProfile.findMany({
        where, take: limit, orderBy: { createdAt: 'desc' },
        select: {
          id: true, specialty: true, title: true,
          employer: true, availability: true,
          user: { select: { displayName: true } },
        },
      });
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `符合条件的专家（${experts.length} 名）`,
          columns: [
            { key: 'name', label: '姓名' },
            { key: 'specialty', label: '专业' },
            { key: 'title', label: '职称' },
            { key: 'employer', label: '单位' },
            { key: 'availability', label: '状态' },
          ],
          rows: experts.map((e) => ({
            name: e.user?.displayName ?? '-',
            specialty: e.specialty,
            title: e.title ?? '-',
            employer: e.employer ?? '-',
            availability: e.availability,
          })),
        }],
      };
    }

    if (action === 'by_specialty') {
      const grouped = await this.prisma.expertProfile.groupBy({
        by: ['specialty'],
        _count: true,
      });
      grouped.sort((a, b) => b._count - a._count);
      const expTotal = grouped.reduce((s, r) => s + r._count, 0);
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '专家专业方向分布',
          columns: [
            { key: 'specialty', label: '专业方向' },
            { key: 'count', label: '人数' },
            { key: 'pct', label: '占比' },
          ],
          rows: grouped.map((g) => ({
            specialty: g.specialty,
            count: g._count,
            pct: expTotal > 0 ? ((g._count / expTotal) * 100).toFixed(1) + '%' : '-',
          })),
          viz: { kind: 'distribution', category: 'specialty', value: 'count' },
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
      bySpecialty.sort((a, b) => b._count - a._count);
      const expTotal = bySpecialty.reduce((s, r) => s + r._count, 0);
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
              { key: 'pct', label: '占比' },
            ],
            rows: bySpecialty.map((s) => ({
              specialty: s.specialty,
              count: s._count,
              pct: expTotal > 0 ? ((s._count / expTotal) * 100).toFixed(1) + '%' : '-',
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
