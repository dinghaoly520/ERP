import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpertAdminService {
  constructor(private prisma: PrismaService) {}

  /** 专家库列表（User role=bid_expert + 关联 BidExpert 统计） */
  async listExperts(search?: string) {
    return this.prisma.user.findMany({
      where: {
        role: 'bid_expert',
        isActive: true,
        ...(search && { displayName: { contains: search, mode: 'insensitive' } }),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        department: { select: { id: true, name: true } },
        bidExperts: {
          select: {
            id: true,
            expertName: true,
            major: true,
            progress: true,
            signedIn: true,
            avoidanceConfirmed: true,
            totalScore: true,
            project: { select: { id: true, name: true, stage: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { displayName: 'asc' },
    });
  }

  /** 专家详情（用户信息 + 全部评审项目 + 评分统计） */
  async getExpert(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        role: true,
        department: { select: { id: true, name: true } },
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const assignments = await this.prisma.bidExpert.findMany({
      where: { userId },
      include: {
        project: {
          select: {
            id: true,
            projectCode: true,
            name: true,
            stage: true,
            procurementMethod: true,
            openTime: true,
          },
        },
        scoreRecords: {
          include: { scoreItem: { select: { name: true, category: true, maxScore: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalProjects = assignments.length;
    const completedProjects = assignments.filter(a => a.progress >= 100).length;
    const signedInProjects = assignments.filter(a => a.signedIn).length;

    return {
      ...user,
      assignments,
      statistics: { totalProjects, completedProjects, signedInProjects },
    };
  }

  /** 专家参与的评审项目列表 */
  async listExpertProjects(userId: string) {
    return this.prisma.bidExpert.findMany({
      where: { userId },
      include: {
        project: {
          select: {
            id: true,
            projectCode: true,
            name: true,
            stage: true,
            procurementMethod: true,
            openTime: true,
            deadline: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
