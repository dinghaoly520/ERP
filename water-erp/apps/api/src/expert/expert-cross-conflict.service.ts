import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CrossConflictResult {
  expertId: string;
  expertName: string;
  conflictType: string;
  conflictDetail: string;
}

@Injectable()
export class ExpertCrossConflictService {
  constructor(private prisma: PrismaService) {}

  /** 检查抽取的专家组内是否存在同单位/关联单位冲突 */
  async checkCrossConflicts(userIds: string[]): Promise<CrossConflictResult[]> {
    if (!userIds.length) return [];
    const profiles = await this.prisma.expertProfile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, employer: true, user: { select: { displayName: true } } },
    });
    const results: CrossConflictResult[] = [];
    const byEmployer = new Map<string, typeof profiles>();
    for (const p of profiles) {
      const key = (p.employer || '').trim();
      if (!key) continue;
      if (!byEmployer.has(key)) byEmployer.set(key, []);
      byEmployer.get(key)!.push(p);
    }
    for (const [, group] of byEmployer) {
      if (group.length < 2) continue;
      for (const member of group) {
        results.push({
          expertId: member.userId,
          expertName: member.user.displayName,
          conflictType: 'same_employer',
          conflictDetail: `与同单位专家存在交叉关系：${member.employer}`,
        });
      }
    }
    return results;
  }
}
