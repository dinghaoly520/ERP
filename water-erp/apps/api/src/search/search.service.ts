import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(q: string, user?: AuthenticatedUser) {
    const query = q.trim();
    if (!query || query.length < 2) return { results: [], total: 0 };

    // 公司域收窄（2026-09-28 审计 P1：此前裸 prisma 绕过公司隔离，非 admin 经 ⌘K
    // 可见跨公司项目/专家）。JWT 不携带 companyId——非 admin 补一次反查。
    // 供应商库按既定口径不隔离（CLAUDE.md「供应商库/目录不隔离」）。
    let companyId: string | undefined;
    if (user && user.role !== 'admin') {
      const u = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { companyId: true },
      });
      companyId = u?.companyId ?? undefined;
    }

    const [suppliers, projects, experts, procurements] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { creditCode: { contains: query } }] },
        select: { id: true, name: true, enterpriseType: true, status: true },
        take: 5,
      }),
      this.prisma.bidProject.findMany({
        where: {
          isExtractionOnly: false,
          ...(companyId ? { companyId } : {}),
          OR: [{ name: { contains: query, mode: 'insensitive' } }, { projectCode: { contains: query } }],
        },
        // projectManagementItemId 供 :3005 项目管理深链（BidProject id ≠ PMI id）
        select: { id: true, name: true, projectCode: true, projectManagementItemId: true },
        take: 5,
      }),
      this.prisma.expertProfile.findMany({
        where: {
          ...(companyId ? { user: { companyId } } : {}),
          OR: [
            { specialty: { contains: query, mode: 'insensitive' } },
            // 姓名在关联 User 上——按姓名搜索是最常见意图，此前只匹配专业永远搜不到（审计 P1）
            { user: { OR: [{ displayName: { contains: query, mode: 'insensitive' } }, { username: { contains: query, mode: 'insensitive' } }] } },
          ],
        },
        select: { id: true, title: true, specialty: true, userId: true, user: { select: { displayName: true, username: true } } },
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
      // 此前 link=/bid/project/:id——:3005 无此路由（属 :3007 命名空间），点击必 404；
      // 现经 projectManagementItemId 映射到项目管理深链，无关联时落到列表页
      ...projects.map(p => ({
        type: 'project', id: p.id, title: p.name, subtitle: p.projectCode,
        link: p.projectManagementItemId ? `/projects?projectId=${p.projectManagementItemId}` : '/projects',
      })),
      // 标题=专家姓名（此前显示职称"高工"），链接直达专家详情（portrait 端点按 User id）
      ...experts.map(e => ({
        type: 'expert', id: e.userId,
        title: e.user?.displayName || e.user?.username || e.title || e.specialty,
        subtitle: `${e.user?.displayName && e.title ? e.title + ' · ' : ''}${e.specialty}`,
        link: e.userId ? `/expert/${e.userId}` : '/expert/repository',
      })),
      ...procurements.map(p => ({ type: 'procurement', id: p.id, title: p.projectCode, subtitle: p.status, link: `/procurements` })),
    ];

    return { results, total: results.length };
  }
}
