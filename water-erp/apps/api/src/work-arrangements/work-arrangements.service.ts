import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProjectManagementStatus,
  WorkArrangementNoteType,
  WorkArrangementRecurrence,
  WorkArrangementStatus,
  WorkArrangementTemplate,
  WorkArrangementType,
  WorkArrangementUrgency,
} from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkArrangementDto } from './dto/create-work-arrangement.dto';
import { CreateWorkArrangementNoteDto } from './dto/create-work-arrangement-note.dto';
import { CreateWorkArrangementTemplateDto } from './dto/create-work-arrangement-template.dto';
import { QueryWorkArrangementsDto } from './dto/query-work-arrangements.dto';
import { UpdateWorkArrangementDto } from './dto/update-work-arrangement.dto';
import { UpdateWorkArrangementTemplateDto } from './dto/update-work-arrangement-template.dto';

type WorkArrangementRecord = Awaited<
  ReturnType<WorkArrangementsService['findArrangementOrThrow']>
>;

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(value: Date) {
  const next = startOfDay(value);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function endOfWeek(value: Date) {
  const next = startOfWeek(value);
  next.setDate(next.getDate() + 6);
  return endOfDay(next);
}

function normalizeTags(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

@Injectable()
export class WorkArrangementsService {
  // 服务端缓存：headerGreeting 每30分钟刷新，内容部分每10分钟刷新
  // 按用户ID分别缓存，避免董事长和普通员工提示词互相污染
  private headerGreetingCache = new Map<string, {
    headerGreeting: string;
    namePraise: string;
    itemCount: number;
    timestamp: number;
  }>();

  private contentCache = new Map<string, {
    data: Record<string, unknown>;
    itemCount: number;
    timestamp: number;
  }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  // 刷新问候语缓存（管理员可调用）
  async refreshDailyGreeting() {
    this.headerGreetingCache.clear();
    this.contentCache.clear();
    return { success: true, message: '问候语缓存已刷新' };
  }

  async list(userId: string, query: QueryWorkArrangementsDto) {
    const where: Record<string, unknown> = { userId };

    if (query.keyword?.trim()) {
      where.OR = [
        { title: { contains: query.keyword.trim(), mode: 'insensitive' } },
        {
          description: { contains: query.keyword.trim(), mode: 'insensitive' },
        },
      ];
    }

    if (query.status) {
      where.status = query.status;
    } else if (!query.includeCompleted) {
      where.status = {
        notIn: [
          WorkArrangementStatus.COMPLETED,
          WorkArrangementStatus.CANCELLED,
        ],
      };
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.urgency) {
      where.urgency = query.urgency;
    }

    if (query.projectManagementItemId) {
      where.projectManagementItemId = query.projectManagementItemId;
    }

    if (query.scope && query.scope !== 'ALL') {
      const anchor = query.date ? new Date(query.date) : new Date();
      const range =
        query.scope === 'TODAY'
          ? { gte: startOfDay(anchor), lte: endOfDay(anchor) }
          : { gte: startOfWeek(anchor), lte: endOfWeek(anchor) };
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { dueAt: range },
        { reminderAt: range },
      ];
    }

    const items = await this.prisma.workArrangement.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { urgency: 'desc' },
        { dueAt: 'asc' },
        { updatedAt: 'desc' },
      ],
      include: {
        notes: { orderBy: { createdAt: 'desc' } },
        template: true,
        projectManagementItem: {
          select: {
            id: true,
            title: true,
            currentStage: true,
            status: true,
          },
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                title: true,
                status: true,
              },
            },
          },
        },
      },
    });

    const serialized = items.map((item) => this.serializeArrangement(item));

    if (query.reminderState) {
      const now = query.date ? new Date(query.date) : new Date();
      return serialized.filter(
        (item) =>
          this.getReminderState(item.reminderAt, now) === query.reminderState,
      );
    }

    return serialized;
  }

  async buildWorkbenchSummary(userId: string, date?: string) {
    const anchor = date ? new Date(date) : new Date();
    const items = await this.prisma.workArrangement.findMany({
      where: {
        userId,
        status: {
          notIn: [
            WorkArrangementStatus.COMPLETED,
            WorkArrangementStatus.CANCELLED,
          ],
        },
      },
      include: {
        notes: { orderBy: { createdAt: 'desc' } },
        template: true,
        projectManagementItem: {
          select: { id: true, title: true, currentStage: true, status: true },
        },
        dependencies: {
          include: {
            dependsOn: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });

    const serialized = items.map((item) => this.serializeArrangement(item));
    const riskCount = serialized.filter(
      (item) =>
        item.status === 'BLOCKED' ||
        this.getReminderState(item.reminderAt, anchor) === 'OVERDUE',
    ).length;

    return {
      todoCount: serialized.filter((item) => item.status === 'TODO').length,
      inProgressCount: serialized.filter(
        (item) => item.status === 'IN_PROGRESS',
      ).length,
      dueTodayCount: serialized.filter(
        (item) => item.dueAt && sameDay(new Date(item.dueAt), anchor),
      ).length,
      riskCount,
    };
  }

  async generateGreeting(userId: string, userName: string) {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);

    // Get task counts for context
    const [pendingCount, inProgressCount, dueTodayCount, completedTodayCount] =
      await Promise.all([
        this.prisma.workArrangement.count({
          where: { userId, status: WorkArrangementStatus.TODO },
        }),
        this.prisma.workArrangement.count({
          where: { userId, status: WorkArrangementStatus.IN_PROGRESS },
        }),
        this.prisma.workArrangement.count({
          where: {
            userId,
            dueAt: { gte: dayStart, lte: dayEnd },
            status: {
              notIn: [
                WorkArrangementStatus.COMPLETED,
                WorkArrangementStatus.CANCELLED,
              ],
            },
          },
        }),
        this.prisma.workArrangement.count({
          where: {
            userId,
            status: WorkArrangementStatus.COMPLETED,
            completedAt: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);

    try {
      return await this.aiService.generateWorkbenchGreeting({
        userName: userName || '用户',
        hourOfDay: now.getHours(),
        pendingCount,
        inProgressCount,
        dueTodayCount,
        completedTodayCount,
        isLeader: false,
      });
    } catch (error) {
      console.error('AI greeting generation failed:', error);
      return {
        greeting: `${userName || '你好'}，欢迎来到工作台，祝你今天工作顺利。`,
      };
    }
  }

  async buildDailyPlan(userId: string, date?: string) {
    const anchor = date ? new Date(date) : new Date();
    const dayStart = startOfDay(anchor);
    const now = Date.now();
    const HEADER_CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存（避免时段错位，如下午3点生成的问候到5点仍在显示）
    const CONTENT_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

    const [user, items] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, role: true, displayName: true },
      }),
      this.prisma.workArrangement.findMany({
      where: {
        userId,
        status: {
          notIn: [
            WorkArrangementStatus.COMPLETED,
            WorkArrangementStatus.CANCELLED,
          ],
        },
      },
      orderBy: [{ urgency: 'desc' }, { dueAt: 'asc' }, { updatedAt: 'desc' }],
      include: {
        projectManagementItem: {
          select: {
            id: true,
            title: true,
            currentStage: true,
            status: true,
          },
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                title: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    ]);

    const relevantItems = items;
    const hasItemsNow = relevantItems.length > 0;

    // 检查 headerGreeting 缓存是否有效（按用户隔离）
    const headerCacheEntry = this.headerGreetingCache.get(userId);
    const headerCacheValid = headerCacheEntry &&
      (now - headerCacheEntry.timestamp) < HEADER_CACHE_TTL &&
      headerCacheEntry.itemCount > 0 === hasItemsNow;

    // 检查内容缓存是否有效（按用户隔离）
    const contentCacheEntry = this.contentCache.get(userId);
    const contentCacheValid = contentCacheEntry &&
      (now - contentCacheEntry.timestamp) < CONTENT_CACHE_TTL &&
      contentCacheEntry.itemCount > 0 === hasItemsNow;

    // 两者都有效，直接组装返回
    if (headerCacheValid && contentCacheValid) {
      return {
        date: dayStart.toISOString(),
        headerGreeting: headerCacheEntry!.headerGreeting,
        namePraise: headerCacheEntry!.namePraise,
        ...contentCacheEntry!.data,
      };
    }

    // 至少有一个缓存过期，需要调 AI
    let result;

    // 董事长/领导/管理员：查询全量项目数据，用于生成项目简报
    const isChairman = user?.username === 'Swhi-CGZX-00';
    const needsProjectBrief = isChairman || user?.role === 'leader' || user?.role === 'admin';
    let allProjects: Array<{
      id: string;
      title: string;
      currentStage: string;
      status: string;
      procurementMethod: string;
      budgetAmount: number | null;
      contractAmount: number | null;
      awardedSupplier: string | null;
      requesterDepartment: string;
    }> | undefined;

    if (needsProjectBrief) {
      const projects = await this.prisma.projectManagementItem.findMany({
        where: {
          status: { notIn: [ProjectManagementStatus.ARCHIVED] },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          title: true,
          currentStage: true,
          status: true,
          procurementMethod: true,
          budgetAmount: true,
          contractAmount: true,
          awardedSupplier: true,
          requesterDepartment: true,
        },
      });
      allProjects = projects.map((p) => ({
        ...p,
        budgetAmount: p.budgetAmount ? Number(p.budgetAmount) : null,
        contractAmount: p.contractAmount ? Number(p.contractAmount) : null,
      }));
    }

    try {
      if (relevantItems.length === 0) {
        result = await this.aiService.analyzeWorkArrangementDailyPlan({
          date: dayStart.toISOString(),
          currentTime: new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
          items: [],
          userContext: user ? { role: user.role, displayName: user.displayName, username: user.username } : undefined,
          chairmanMode: isChairman || undefined,
          projects: allProjects,
        });
      } else {
        result = await this.aiService.analyzeWorkArrangementDailyPlan({
          date: dayStart.toISOString(),
          currentTime: new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
          items: relevantItems.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description ?? '',
            type: item.type,
            urgency: item.urgency,
            status: item.status,
            dueAt: item.dueAt?.toISOString() ?? null,
            reminderAt: item.reminderAt?.toISOString() ?? null,
            estimatedMinutes: item.estimatedMinutes ?? null,
            customTags: normalizeTags(item.customTags),
            project: item.projectManagementItem
              ? {
                  id: item.projectManagementItem.id,
                  title: item.projectManagementItem.title,
                  currentStage: item.projectManagementItem.currentStage,
                  status: item.projectManagementItem.status,
                }
              : null,
            dependencies: item.dependencies.map((dependency) => ({
              id: dependency.dependsOn.id,
              title: dependency.dependsOn.title,
              status: dependency.dependsOn.status,
            })),
          })),
          userContext: user ? { role: user.role, displayName: user.displayName, username: user.username } : undefined,
          chairmanMode: isChairman || undefined,
          projects: allProjects,
        });
      }
    } catch (error) {
      console.error('AI daily plan generation failed:', error);
      result = {
        date: dayStart.toISOString(),
        headerGreeting: '',
        namePraise: '',
        dailyGreeting: '',
        riskSummary: '',
        aiSuggestion: '',
        overview: '',
        focusItems: [],
        timeBlocks: [],
        riskAlerts: [],
        completionAdvice: '',
        projectBrief: '',
      };
    }

    // 如果 headerGreeting 缓存仍有效，保留旧的；否则用新生成的
    const finalHeaderGreeting = headerCacheValid
      ? headerCacheEntry!.headerGreeting
      : result.headerGreeting;
    const finalNamePraise = headerCacheValid
      ? headerCacheEntry!.namePraise
      : result.namePraise;

    // 更新 headerGreeting 缓存（仅在失效时，按用户隔离）
    if (!headerCacheValid) {
      this.headerGreetingCache.set(userId, {
        headerGreeting: finalHeaderGreeting,
        namePraise: finalNamePraise,
        itemCount: relevantItems.length,
        timestamp: now,
      });
    }

    // 更新内容缓存（按用户隔离）
    const { headerGreeting: _, namePraise: ___, date: __, ...contentWithoutHeader } = result;
    this.contentCache.set(userId, {
      data: { ...contentWithoutHeader },
      itemCount: relevantItems.length,
      timestamp: now,
    });

    return {
      date: dayStart.toISOString(),
      headerGreeting: finalHeaderGreeting,
      namePraise: finalNamePraise,
      ...contentWithoutHeader,
    };
  }

  async listTemplates(userId: string) {
    const templates = await this.prisma.workArrangementTemplate.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return templates.map((template) => this.serializeTemplate(template));
  }

  async createTemplate(userId: string, dto: CreateWorkArrangementTemplateDto) {
    const template = await this.prisma.workArrangementTemplate.create({
      data: {
        userId,
        name: dto.name.trim(),
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        type: dto.type as WorkArrangementType,
        urgency: dto.urgency as WorkArrangementUrgency,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        isAllDay: dto.isAllDay ?? true,
        customTags: dto.customTags ?? [],
        recurrence: (dto.recurrence ?? 'NONE') as WorkArrangementRecurrence,
      },
    });

    return this.serializeTemplate(template);
  }

  async updateTemplate(
    userId: string,
    id: string,
    dto: UpdateWorkArrangementTemplateDto,
  ) {
    await this.findTemplateOrThrow(userId, id);

    const template = await this.prisma.workArrangementTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        title: dto.title?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description?.trim() || null,
        type: dto.type as WorkArrangementType | undefined,
        urgency: dto.urgency as WorkArrangementUrgency | undefined,
        estimatedMinutes:
          dto.estimatedMinutes === undefined ? undefined : dto.estimatedMinutes,
        isAllDay: dto.isAllDay,
        customTags: dto.customTags,
        recurrence: dto.recurrence as WorkArrangementRecurrence | undefined,
      },
    });

    return this.serializeTemplate(template);
  }

  async deleteTemplate(userId: string, id: string) {
    await this.findTemplateOrThrow(userId, id);

    await this.prisma.workArrangementTemplate.delete({ where: { id } });

    return { success: true };
  }

  async create(userId: string, dto: CreateWorkArrangementDto) {
    await this.validateProjectLink(dto.projectManagementItemId);
    await this.validateDependencies(userId, dto.dependencyIds ?? []);

    const arrangement = await this.prisma.workArrangement.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        type: dto.type as WorkArrangementType,
        urgency: dto.urgency as WorkArrangementUrgency,
        status: (dto.status ?? 'TODO') as WorkArrangementStatus,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        isAllDay: dto.isAllDay ?? true,
        customTags: dto.customTags ?? [],
        recurrence: (dto.recurrence ?? 'NONE') as WorkArrangementRecurrence,
        projectManagementItemId: dto.projectManagementItemId ?? null,
        templateId: dto.templateId ?? null,
        completionSummary: dto.completionSummary?.trim() || null,
        reflectionSummary: dto.reflectionSummary?.trim() || null,
        completedAt: dto.status === 'COMPLETED' ? new Date() : null,
        dependencies: dto.dependencyIds?.length
          ? {
              createMany: {
                data: dto.dependencyIds.map((dependsOnId) => ({ dependsOnId })),
              },
            }
          : undefined,
      },
      include: {
        notes: { orderBy: { createdAt: 'desc' } },
        template: true,
        projectManagementItem: {
          select: { id: true, title: true, currentStage: true, status: true },
        },
        dependencies: {
          include: {
            dependsOn: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });

    return this.serializeArrangement(arrangement);
  }

  async update(userId: string, id: string, dto: UpdateWorkArrangementDto) {
    await this.findArrangementOrThrow(userId, id);
    await this.validateProjectLink(dto.projectManagementItemId ?? undefined);
    if (dto.dependencyIds) {
      await this.validateDependencies(userId, dto.dependencyIds, id);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.dependencyIds) {
        await tx.workArrangementDependency.deleteMany({
          where: { workArrangementId: id },
        });

        if (dto.dependencyIds.length) {
          await tx.workArrangementDependency.createMany({
            data: dto.dependencyIds.map((dependsOnId) => ({
              workArrangementId: id,
              dependsOnId,
            })),
          });
        }
      }

      await tx.workArrangement.update({
        where: { id },
        data: {
          title: dto.title?.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description?.trim() || null,
          type: dto.type as WorkArrangementType | undefined,
          urgency: dto.urgency as WorkArrangementUrgency | undefined,
          status: dto.status as WorkArrangementStatus | undefined,
          dueAt:
            dto.dueAt === undefined
              ? undefined
              : dto.dueAt
                ? new Date(dto.dueAt)
                : null,
          reminderAt:
            dto.reminderAt === undefined
              ? undefined
              : dto.reminderAt
                ? new Date(dto.reminderAt)
                : null,
          estimatedMinutes:
            dto.estimatedMinutes === undefined
              ? undefined
              : dto.estimatedMinutes,
          isAllDay: dto.isAllDay,
          customTags: dto.customTags,
          recurrence: dto.recurrence as WorkArrangementRecurrence | undefined,
          projectManagementItemId:
            dto.projectManagementItemId === undefined
              ? undefined
              : dto.projectManagementItemId || null,
          templateId:
            dto.templateId === undefined ? undefined : dto.templateId || null,
          completionSummary:
            dto.completionSummary === undefined
              ? undefined
              : dto.completionSummary?.trim() || null,
          reflectionSummary:
            dto.reflectionSummary === undefined
              ? undefined
              : dto.reflectionSummary?.trim() || null,
          completedAt:
            dto.status === undefined
              ? undefined
              : dto.status === 'COMPLETED'
                ? new Date()
                : null,
        },
      });
    });

    return this.serializeArrangement(
      await this.findArrangementOrThrow(userId, id),
    );
  }

  async delete(userId: string, id: string) {
    await this.findArrangementOrThrow(userId, id);
    await this.prisma.workArrangement.delete({ where: { id } });
    return { success: true };
  }

  async postponeReminder(
    userId: string,
    id: string,
    dto: {
      preset:
        | 'PLUS_30_MINUTES'
        | 'THIS_AFTERNOON'
        | 'TOMORROW_MORNING'
        | 'CUSTOM';
      targetAt?: string;
    },
  ) {
    const arrangement = await this.findArrangementOrThrow(userId, id);

    const nextReminderAt = this.resolvePostponedReminderAt(
      arrangement.reminderAt,
      dto,
    );

    await this.prisma.workArrangement.update({
      where: { id },
      data: { reminderAt: nextReminderAt },
    });

    return this.serializeArrangement(
      await this.findArrangementOrThrow(userId, id),
    );
  }

  async addNote(userId: string, id: string, dto: CreateWorkArrangementNoteDto) {
    await this.findArrangementOrThrow(userId, id);

    return this.prisma.workArrangementNote.create({
      data: {
        workArrangementId: id,
        type: dto.type as WorkArrangementNoteType,
        content: dto.content.trim(),
      },
    });
  }

  private async findArrangementOrThrow(userId: string, id: string) {
    const arrangement = await this.prisma.workArrangement.findFirst({
      where: { id, userId },
      include: {
        notes: { orderBy: { createdAt: 'desc' } },
        template: true,
        projectManagementItem: {
          select: { id: true, title: true, currentStage: true, status: true },
        },
        dependencies: {
          include: {
            dependsOn: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });

    if (!arrangement) {
      throw new NotFoundException('未找到对应的工作安排。');
    }

    return arrangement;
  }

  private async findTemplateOrThrow(userId: string, id: string) {
    const template = await this.prisma.workArrangementTemplate.findFirst({
      where: { id, userId },
    });

    if (!template) {
      throw new NotFoundException('未找到对应的工作模板。');
    }

    return template;
  }

  private async validateProjectLink(projectManagementItemId?: string) {
    if (!projectManagementItemId) {
      return;
    }

    const linkedProject = await this.prisma.projectManagementItem.findUnique({
      where: { id: projectManagementItemId },
      select: { id: true },
    });

    if (!linkedProject) {
      throw new BadRequestException('关联的项目不存在。');
    }
  }

  private async validateDependencies(
    userId: string,
    dependencyIds: string[],
    currentId?: string,
  ) {
    const uniqueIds = [...new Set(dependencyIds)].filter(Boolean);

    if (currentId && uniqueIds.includes(currentId)) {
      throw new BadRequestException('工作安排不能依赖自身。');
    }

    if (!uniqueIds.length) {
      return;
    }

    const count = await this.prisma.workArrangement.count({
      where: { id: { in: uniqueIds }, userId },
    });

    if (count !== uniqueIds.length) {
      throw new BadRequestException('依赖事项中存在无效记录或不属于当前账号。');
    }
  }

  private getReminderState(reminderAt: string | Date | null, now: Date) {
    if (!reminderAt) {
      return 'NONE';
    }

    const reminderDate = new Date(reminderAt);
    const deltaMs = reminderDate.getTime() - now.getTime();

    if (deltaMs < 0) {
      return 'OVERDUE';
    }

    if (deltaMs <= 15 * 60 * 1000) {
      return 'DUE_NOW';
    }

    if (deltaMs <= 2 * 60 * 60 * 1000) {
      return 'UPCOMING';
    }

    return 'NONE';
  }

  private resolvePostponedReminderAt(
    reminderAt: Date | string | null,
    dto: {
      preset:
        | 'PLUS_30_MINUTES'
        | 'THIS_AFTERNOON'
        | 'TOMORROW_MORNING'
        | 'CUSTOM';
      targetAt?: string;
    },
  ) {
    if (dto.preset === 'CUSTOM') {
      if (!dto.targetAt) {
        throw new BadRequestException('自定义提醒时间不能为空。');
      }
      return new Date(dto.targetAt);
    }

    if (!reminderAt) {
      throw new BadRequestException('当前工作尚未设置提醒时间。');
    }

    const anchor = new Date(reminderAt);

    if (dto.preset === 'PLUS_30_MINUTES') {
      return addMinutes(anchor, 30);
    }

    if (dto.preset === 'THIS_AFTERNOON') {
      const target = new Date(anchor);
      target.setHours(15, 0, 0, 0);
      return target;
    }

    const target = new Date(anchor);
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return target;
  }

  private serializeTemplate(template: WorkArrangementTemplate) {
    return {
      ...template,
      customTags: normalizeTags(template.customTags),
    };
  }

  async listAll() {
    const items = await this.prisma.workArrangement.findMany({
      orderBy: [
        { status: 'asc' },
        { urgency: 'desc' },
        { dueAt: 'asc' },
        { updatedAt: 'desc' },
      ],
      include: {
        user: {
          select: { id: true, displayName: true, username: true },
        },
        notes: { orderBy: { createdAt: 'desc' } },
        template: true,
        projectManagementItem: {
          select: { id: true, title: true, currentStage: true, status: true },
        },
        dependencies: {
          include: {
            dependsOn: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });

    return items.map((item) => this.serializeArrangement(item));
  }

  private serializeArrangement(arrangement: WorkArrangementRecord) {
    return {
      ...arrangement,
      customTags: normalizeTags(arrangement.customTags),
      projectManagementItem: arrangement.projectManagementItem
        ? {
            ...arrangement.projectManagementItem,
            visibility: {
              showTitle: true,
              showStatus: true,
              showDueAt: true,
              showOwner: true,
            },
          }
        : null,
      dependencies: arrangement.dependencies.map((dependency) => ({
        id: dependency.dependsOn.id,
        title: dependency.dependsOn.title,
        status: dependency.dependsOn.status,
      })),
    };
  }
}
