import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(q: string) {
    const query = q.trim();
    if (!query || query.length < 2) return { results: [], total: 0 };

    const [suppliers, projects, experts, procurements] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { creditCode: { contains: query } }] },
        select: { id: true, name: true, enterpriseType: true, status: true },
        take: 5,
      }),
      this.prisma.bidProject.findMany({
        where: { isExtractionOnly: false, OR: [{ name: { contains: query, mode: 'insensitive' } }, { projectCode: { contains: query } }] },
        select: { id: true, name: true, projectCode: true },
        take: 5,
      }),
      this.prisma.expertProfile.findMany({
        where: { specialty: { contains: query, mode: 'insensitive' } },
        select: { id: true, title: true, specialty: true },
        take: 5,
      }),
      this.prisma.procurementProject.findMany({
        where: { projectCode: { contains: query, mode: 'insensitive' } },
        select: { id: true, projectCode: true, status: true },
        take: 5,
      }),
    ]);

    const results = [
      ...suppliers.map(s => ({ type: 'supplier', id: s.id, title: s.name, subtitle: `${s.enterpriseType || ''} · ${s.status}`, link: `/supplier/${s.id}` })),
      ...projects.map(p => ({ type: 'project', id: p.id, title: p.name, subtitle: p.projectCode, link: `/bid/project/${p.id}` })),
      ...experts.map(e => ({ type: 'expert', id: e.id, title: e.title || e.specialty, subtitle: e.specialty, link: `/expert/repository` })),
      ...procurements.map(p => ({ type: 'procurement', id: p.id, title: p.projectCode, subtitle: p.status, link: `/procurements` })),
    ];

    return { results, total: results.length };
  }
}
