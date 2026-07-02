import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectManagementStatus } from '@prisma/client';
import { AiService } from '../ai/ai.service';

export interface ProjectWithCreator {
  id: string;
  title: string;
  projectName: string;
  requesterName: string;
  requesterDepartment: string;
  procurementMethod: string;
  currentStage: string;
  status: ProjectManagementStatus;
  budgetAmount: number;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  createdBy: {
    id: string;
    displayName: string;
    username: string;
  } | null;
  stages: Array<{
    stageKey: string;
    stageName: string;
    stageOrder: number;
    status: string;
    completedAt: Date | null;
  }>;
}

export interface ProgressStats {
  totalActive: number;
  stageDistribution: Array<{
    stage: string;
    count: number;
  }>;
  projects: ProjectWithCreator[];
  // 新增：月度统计
  monthlyAdded: number;
  monthlyCompleted: number;
  recentlyActive: number;
  // 新增：效率指标
  avgDaysPerStage: number;
  totalCompleted: number;
  // 新增：历史对比
  lastMonthCompleted: number;
  lastMonthAdded: number;
}

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async getProgressStats(userId?: string, stage?: string): Promise<ProgressStats> {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const where: Record<string, unknown> = {
      status: ProjectManagementStatus.ACTIVE,
    };

    if (userId) {
      where.createdById = userId;
    }

    if (stage) {
      where.currentStage = stage;
    }

    const projects = await this.prisma.projectManagementItem.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        stages: {
          orderBy: {
            stageOrder: 'asc',
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Calculate stage distribution
    const stageMap = new Map<string, number>();
    for (const project of projects) {
      const currentStage = project.currentStage || '未设置';
      stageMap.set(currentStage, (stageMap.get(currentStage) || 0) + 1);
    }

    const stageDistribution = Array.from(stageMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    // Transform budget amount and map demandProject -> projectName
    const transformedProjects = projects.map((project) => ({
      ...project,
      projectName: project.demandProject || '',
      budgetAmount: project.budgetAmount ? Number(project.budgetAmount) : 0,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    }));

    // 月度统计
    const monthlyAdded = await this.prisma.projectManagementItem.count({
      where: {
        createdAt: { gte: startOfThisMonth },
        ...(userId && { createdById: userId }),
      },
    });

    const monthlyCompleted = await this.prisma.projectManagementItem.count({
      where: {
        currentStage: 'CONTRACT',
        updatedAt: { gte: startOfThisMonth },
        ...(userId && { createdById: userId }),
      },
    });

    const recentlyActive = projects.filter(
      (p) => p.updatedAt >= sevenDaysAgo
    ).length;

    // 上月数据（用于对比）
    const lastMonthAdded = await this.prisma.projectManagementItem.count({
      where: {
        createdAt: { gte: startOfLastMonth, lt: endOfLastMonth },
        ...(userId && { createdById: userId }),
      },
    });

    const lastMonthCompleted = await this.prisma.projectManagementItem.count({
      where: {
        currentStage: 'CONTRACT',
        updatedAt: { gte: startOfLastMonth, lt: endOfLastMonth },
        ...(userId && { createdById: userId }),
      },
    });

    // 总完成数（用于计算健康度）
    const totalCompleted = await this.prisma.projectManagementItem.count({
      where: {
        currentStage: 'CONTRACT',
        ...(userId && { createdById: userId }),
      },
    });

    const completedProjects = await this.prisma.projectManagementItem.findMany({
      where: {
        currentStage: 'CONTRACT',
        ...(userId && { createdById: userId }),
      },
      include: {
        stages: {
          where: { completedAt: { not: null } },
          orderBy: { stageOrder: 'asc' },
        },
      },
      take: 100,
    });

    let avgDaysPerStage = 0;
    if (completedProjects.length > 0) {
      const totalStageDays = completedProjects.reduce((sum, project) => {
        if (project.stages.length < 2) return sum;
        const firstStage = project.stages[0];
        const lastStage = project.stages[project.stages.length - 1];
        if (firstStage.completedAt && lastStage.completedAt) {
          const days = Math.floor(
            (lastStage.completedAt.getTime() - firstStage.completedAt.getTime()) /
              (1000 * 60 * 60 * 24)
          );
          return sum + Math.max(0, days);
        }
        return sum;
      }, 0);
      avgDaysPerStage = Math.round(
        totalStageDays / completedProjects.length / 8
      ); // 假设8个阶段
    }

    return {
      totalActive: projects.length,
      stageDistribution,
      projects: transformedProjects,
      monthlyAdded,
      monthlyCompleted,
      recentlyActive,
      avgDaysPerStage,
      totalCompleted,
      lastMonthCompleted,
      lastMonthAdded,
    };
  }

  async getAiInsights(userId?: string, stage?: string) {
    const stats = await this.getProgressStats(userId, stage);

    const stageNames: Record<string, string> = {
      PROCUREMENT_DEMAND: '采购需求',
      INITIATION: '采购立项',
      TENDER_DOCUMENT: '采购文件',
      PUBLIC_ANNOUNCEMENT: '采购公示',
      EXPERT_SELECTION: '专家抽取',
      BID_EVALUATION: '评标过程',
      AWARD_DECISION: '定标',
      CONTRACT: '合同',
    };

    const projectSummaries = stats.projects.map((p) => {
      const completedStages = p.stages.filter((s) => s.status === 'COMPLETED').length;
      const totalStages = p.stages.length;
      const progressPercent = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;
      const daysSinceUpdate = Math.max(
        0,
        Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
      );

      return {
        title: p.title,
        requesterName: p.requesterName || p.createdBy?.displayName || '未登记',
        department: p.requesterDepartment || '未设置',
        procurementMethod: p.procurementMethod || '未设置',
        currentStage: stageNames[p.currentStage] || p.currentStage || '未设置',
        progress: `${progressPercent}%`,
        budget: p.budgetAmount ? `${(p.budgetAmount / 10000).toFixed(1)}万` : '未设置',
        daysSinceUpdate,
        completedStages,
        totalStages,
      };
    });

    const totalBudget = stats.projects.reduce(
      (sum, p) => sum + (p.budgetAmount || 0),
      0,
    );
    const avgCompletion =
      stats.projects.length > 0
        ? Math.round(
            stats.projects.reduce((sum, p) => {
              const completed = p.stages.filter((s) => s.status === 'COMPLETED').length;
              const total = p.stages.length;
              return sum + (total > 0 ? (completed / total) * 100 : 0);
            }, 0) / stats.projects.length,
          )
        : 0;

    const stalledProjects = stats.projects.filter((p) => {
      const days = Math.max(0, Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / (1000 * 60 * 60 * 24)));
      return days > 7;
    }).length;

    const systemPrompt = `你是采购中心的进度分析顾问。基于当前项目数据，生成进度洞察分析。

请输出一个 JSON 对象，结构固定为：
{
  "overview": "综合态势判断，60-90字，一句话概括当前整体进度状况和关键风险",
  "insights": [
    {
      "type": "risk|bottleneck|budget|completion|rhythm",
      "message": "洞察内容，30-50字，必须包含具体数据",
      "urgency": "low|medium|high",
      "projectTitles": ["相关项目名称"],
      "stageFilter": "阶段筛选值（可选，如 PROCUREMENT_DEMAND）",
      "actionLabel": "操作按钮文字（可选）"
    }
  ]
}

【严格生成 5 条洞察，按以下优先级顺序生成】

1. risk（风险预警）— 最高优先级
   识别停滞超过7天的项目。必须列出具体项目名称和停滞天数。
   例："XX设备采购项目已停滞12天未更新，当前处于评标过程阶段。"（这不是建议，是事实陈述）
   urgency: 停滞>14天用 high，>7天用 medium。必须设 actionLabel。

2. bottleneck（瓶颈识别）— 高优先级
   识别项目最集中的阶段。必须说明该阶段具体有几个项目、叫什么名字。
   例："采购文件阶段当前聚集了3个项目（XX项目、YY项目、ZZ项目），占总数43%。"
   必须设 stageFilter 和 actionLabel。

3. budget（预算关注）— 中优先级
   识别预算金额最大的2-3个项目，说明金额和当前进度。
   例："预算最高的XX项目（85.6万）完成度仅25%，YY项目（62.3万）停滞9天。"
   必须列出具体项目名和金额。必须设 actionLabel。

4. completion（即将完成）— 低优先级
   识别完成度>=60%的具体项目。说明项目名称和完成度百分比。
   例："XX项目完成度已达87%（7/8阶段），YY项目完成度75%，均有望近期收尾。"
   必须设 actionLabel。

5. rhythm（节奏研判）— 收尾
   用数据说明近期更新情况。必须列出具体项目的更新时间。
   例："近3天仅XX项目和YY项目有更新，其余5个项目无动静，整体推进节奏偏缓。"
   不要给任何"建议标准化模板"之类的空泛建议，只陈述数据事实。

【严格禁止】
1. 禁止输出任何建议性内容，如"建议标准化模板"、"可提前准备"、"应加快进度"、"优化流程"等
2. 禁止编造数据中不存在的数字
3. 禁止输出空泛的套话，每条洞察必须包含至少一个具体项目名称
4. projectTitles 必须是数据中真实存在的项目名称
5. 不要重复 overview 中已说过的内容

【规则】
1. 如果某个维度没有对应数据（如无停滞项目），跳过该维度，从剩余维度补充事实观察
2. overview 必须基于实际数字
3. 每条 message 只陈述数据事实，不给建议

【语言风格】
只陈述事实和数据，不做建议。专业简洁。`.trim();

    const userPrompt = JSON.stringify(
      {
        summary: {
          totalActive: stats.totalActive,
          averageCompletion: `${avgCompletion}%`,
          totalBudget: `${(totalBudget / 10000).toFixed(1)}万`,
          monthlyAdded: stats.monthlyAdded,
          monthlyCompleted: stats.monthlyCompleted,
          recentlyActive: stats.recentlyActive,
          stalledProjects,
        },
        stageDistribution: stats.stageDistribution.map((s) => ({
          stage: stageNames[s.stage] || s.stage,
          count: s.count,
        })),
        projects: projectSummaries,
      },
      null,
      2,
    );

    try {
      const content = await this.aiService.chatJson(systemPrompt, userPrompt, 0.4);

      const parsed = JSON.parse(content) as {
        overview?: string;
        insights?: Array<{
          type?: string;
          message?: string;
          urgency?: string;
          projectTitles?: string[];
          stageFilter?: string;
          actionLabel?: string;
        }>;
      };

      const titleToIdMap = new Map(stats.projects.map((p) => [p.title, p.id]));

      const resolveProjectIds = (titles: string[]): string[] => {
        const ids: string[] = [];
        for (const title of titles) {
          const exact = titleToIdMap.get(title);
          if (exact) {
            ids.push(exact);
            continue;
          }
          // Fuzzy: check if the title contains or is contained by a real project title
          const normalized = title.trim().toLowerCase();
          for (const [realTitle, id] of titleToIdMap) {
            const normalizedReal = realTitle.trim().toLowerCase();
            if (normalizedReal.includes(normalized) || normalized.includes(normalizedReal)) {
              ids.push(id);
              break;
            }
          }
        }
        return ids;
      };

      return {
        overview: parsed.overview ?? '',
        insights: Array.isArray(parsed.insights)
          ? parsed.insights.map((item, idx) => ({
              id: `ai-insight-${idx}`,
              type: item.type ?? 'observation',
              message: item.message ?? '',
              urgency: (['low', 'medium', 'high'].includes(item.urgency ?? '')
                ? item.urgency
                : 'low') as 'low' | 'medium' | 'high',
              relatedProjectIds: resolveProjectIds(item.projectTitles ?? []),
              relatedStageKey: item.stageFilter ?? null,
              actionLabel: item.actionLabel ?? null,
            }))
          : [],
      };
    } catch (err) {
      this.logger.warn(`AI insights generation failed: ${(err as Error).message}`);
      return { overview: '', insights: [] };
    }
  }
}
