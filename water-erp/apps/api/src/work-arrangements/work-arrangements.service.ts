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

  /** 避免同一用户同时触发多次后台刷新（fire-and-forget lock） */
  private dbRefreshLocks = new Map<string, Promise<void>>();
  /** DB 缓存新鲜度窗口：2 小时内视为新鲜，直接返回无需刷新 */
  private static readonly DB_CACHE_FRESH_MS = 2 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  /** 从 DB 读取已缓存的每日计划（按用户 + 日期隔离） */
  private async readDbCachedPlan(userId: string, date: string) {
    const row = await this.prisma.workArrangementDailyPlanCache.findUnique({
      where: { userId_date: { userId, date } },
    });
    return row ? (row.plan as Record<string, unknown>) : null;
  }

  /** 将每日计划持久化到 DB，upsert 保证幂等 */
  private async saveDbCachedPlan(userId: string, date: string, plan: Record<string, any>) {
    await this.prisma.workArrangementDailyPlanCache.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, plan },
      update: { plan },
    });
  }

  /**
   * 后台异步刷新每日计划 —— fire-and-forget，不阻塞当前请求。
   * 同一用户同一天同时最多一个刷新任务，避免请求风暴导致重复调用 AI。
   */
  private refreshPlanInBackground(
    userId: string,
    dateStr: string,
    dayStart: Date,
    now: number,
  ): void {
    const lockKey = `${userId}:${dateStr}`;
    if (this.dbRefreshLocks.has(lockKey)) return; // 已有刷新进行中

    const promise = (async () => {
      try {
        // --- 复用 buildDailyPlan 的核心逻辑，生成最新的 AI 排程 ---
        const [user, items] = await Promise.all([
          this.prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, role: true, displayName: true },
          }),
          this.prisma.workArrangement.findMany({
            where: {
              userId,
              status: { notIn: [WorkArrangementStatus.COMPLETED, WorkArrangementStatus.CANCELLED] },
            },
            orderBy: [{ urgency: 'desc' }, { dueAt: 'asc' }, { updatedAt: 'desc' }],
            include: {
              projectManagementItem: { select: { id: true, title: true, currentStage: true, status: true } },
              dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
            },
          }),
        ]);

        // 董事长/领导模式
        const isChairman = user?.username === 'Swhi-CGZX-00';
        const needsProjectBrief = isChairman || user?.role === 'leader' || user?.role === 'admin';
        let allProjects: any[] | undefined;
        if (needsProjectBrief) {
          allProjects = await this.prisma.projectManagementItem.findMany({
            where: { status: { notIn: [ProjectManagementStatus.ARCHIVED] } },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
            select: { id: true, title: true, currentStage: true, status: true, procurementMethod: true, budgetAmount: true, contractAmount: true, awardedSupplier: true, requesterDepartment: true },
          });
        }

        const result = await this.aiService.analyzeWorkArrangementDailyPlan({
          date: dayStart.toISOString(),
          currentTime: new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
          items: items.map((item) => ({
            id: item.id, title: item.title, description: item.description ?? '',
            type: item.type, urgency: item.urgency, status: item.status,
            dueAt: item.dueAt?.toISOString() ?? null,
            reminderAt: item.reminderAt?.toISOString() ?? null,
            estimatedMinutes: item.estimatedMinutes ?? null,
            customTags: normalizeTags(item.customTags),
            project: item.projectManagementItem ? { id: item.projectManagementItem.id, title: item.projectManagementItem.title, currentStage: item.projectManagementItem.currentStage, status: item.projectManagementItem.status } : null,
            dependencies: item.dependencies.map((dep) => ({ id: dep.dependsOn.id, title: dep.dependsOn.title, status: dep.dependsOn.status })),
          })),
          userContext: user ? { role: user.role, displayName: user.displayName, username: user.username } : undefined,
          chairmanMode: isChairman || undefined,
          projects: allProjects,
        });

        // 更新内存缓存 L1
        const { headerGreeting: _, namePraise: __, date: ___, ...contentWithoutHeader } = result;
        this.headerGreetingCache.set(userId, {
          headerGreeting: result.headerGreeting, namePraise: result.namePraise,
          itemCount: items.length, timestamp: now,
        });
        this.contentCache.set(userId, { data: { ...contentWithoutHeader }, itemCount: items.length, timestamp: now });

        // 持久化到 DB
        await this.saveDbCachedPlan(userId, dateStr, {
          date: dayStart.toISOString(),
          headerGreeting: result.headerGreeting,
          namePraise: result.namePraise,
          dailyGreeting: result.dailyGreeting,
          riskSummary: result.riskSummary,
          aiSuggestion: result.aiSuggestion,
          overview: result.overview,
          focusItems: result.focusItems,
          timeBlocks: result.timeBlocks,
          riskAlerts: result.riskAlerts,
          completionAdvice: result.completionAdvice,
          projectBrief: result.projectBrief,
        });
      } catch (err) {
        console.error('Background daily plan refresh failed:', err);
      } finally {
        this.dbRefreshLocks.delete(lockKey);
      }
    })();

    this.dbRefreshLocks.set(lockKey, promise);
  }

  // 刷新问候语缓存（管理员可调用）
  async refreshDailyGreeting() {
    this.headerGreetingCache.clear();
    this.contentCache.clear();
    return { success: true, message: '问候语缓存已刷新' };
  }

  /** 强制重新生成并缓存每日计划（供前端 Refresh 按钮使用） */
  async regenerateDailyPlan(userId: string, date?: string) {
    const anchor = date ? new Date(date) : new Date();
    const dayStart = startOfDay(anchor);
    const today = dayStart.toISOString().slice(0, 10);
    const now = Date.now();

    // 清空内存缓存，强制走完整生成流程
    this.headerGreetingCache.delete(userId);
    this.contentCache.delete(userId);

    // 调用完整的 buildDailyPlan（无缓存时会走 AI 生成）
    return this.buildDailyPlanInternal(userId, today, dayStart, now, true);
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
        greeting: '欢迎来到工作台，祝你今天工作顺利。',
      };
    }
  }

  async buildPortrait(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true, role: true },
    });
    if (!user) throw new Error('用户不存在');

    const [activities, workItems] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId },
        select: { action: true, resourceType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.workArrangement.findMany({
        where: { userId },
        select: { type: true, status: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    for (const item of workItems) {
      if (item.status !== 'CANCELLED') {
        byType[item.type] = (byType[item.type] || 0) + 1;
      }
    }

    return this.aiService.analyzeWorkPortrait({
      userContext: { displayName: user.displayName, username: user.username, role: user.role },
      auditActivities: activities as any,
      taskSummary: {
        total: workItems.filter(i => i.status !== 'CANCELLED').length,
        completed: workItems.filter(i => i.status === 'COMPLETED').length,
        byType,
      },
    });
  }

  async buildDailyPlan(userId: string, date?: string) {
    const anchor = date ? new Date(date) : new Date();
    const dayStart = startOfDay(anchor);
    const today = dayStart.toISOString().slice(0, 10);
    const now = Date.now();
    const HEADER_CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存（避免时段错位）
    const CONTENT_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

    // ── FAST PATH: 检查 DB 持久化缓存 ──
    const dbCached = await this.readDbCachedPlan(userId, today);
    if (dbCached) {
      // 判断 DB 缓存的新鲜度
      const dbRow = await this.prisma.workArrangementDailyPlanCache.findUnique({
        where: { userId_date: { userId, date: today } },
        select: { updatedAt: true },
      });
      const dbAge = dbRow ? now - dbRow.updatedAt.getTime() : Infinity;

      if (dbAge < WorkArrangementsService.DB_CACHE_FRESH_MS) {
        // DB 缓存新鲜（< 2 小时） → 直接返回，无需查询任务表
        return dbCached;
      }

      // DB 缓存存在但已过期 → 先返回缓存数据，后台异步刷新
      void this.refreshPlanInBackground(userId, today, dayStart, now);
      return dbCached;
    }

    // ── SLOW PATH: 无 DB 缓存，需要完整生成（首次访问或缓存被清理）──
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

    // 检查 L1 内存缓存是否有效
    const headerCacheEntry = this.headerGreetingCache.get(userId);
    const headerCacheValid = headerCacheEntry &&
      (now - headerCacheEntry.timestamp) < HEADER_CACHE_TTL &&
      headerCacheEntry.itemCount > 0 === hasItemsNow;

    const contentCacheEntry = this.contentCache.get(userId);
    const contentCacheValid = contentCacheEntry &&
      (now - contentCacheEntry.timestamp) < CONTENT_CACHE_TTL &&
      contentCacheEntry.itemCount > 0 === hasItemsNow;

    // L1 缓存有效 → 组装返回 + 持久化到 DB（首次落盘）
    if (headerCacheValid && contentCacheValid) {
      const response = {
        date: dayStart.toISOString(),
        headerGreeting: headerCacheEntry!.headerGreeting,
        namePraise: headerCacheEntry!.namePraise,
        ...contentCacheEntry!.data,
      };
      void this.saveDbCachedPlan(userId, today, response as any);
      return response;
    }

    // 至少有一个缓存过期，需要调 AI
    let result;

    // 董事长/领导/管理员：查询全量项目数据
    const isChairman = user?.username === 'Swhi-CGZX-00';
    const needsProjectBrief = isChairman || user?.role === 'leader' || user?.role === 'admin';
    let allProjects: Array<{
      id: string; title: string; currentStage: string; status: string;
      procurementMethod: string; budgetAmount: number | null;
      contractAmount: number | null; awardedSupplier: string | null;
      requesterDepartment: string;
    }> | undefined;

    if (needsProjectBrief) {
      allProjects = (await this.prisma.projectManagementItem.findMany({
        where: { status: { notIn: [ProjectManagementStatus.ARCHIVED] } },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true, title: true, currentStage: true, status: true,
          procurementMethod: true, budgetAmount: true,
          contractAmount: true, awardedSupplier: true,
          requesterDepartment: true,
        },
      })).map((p) => ({
        ...p, budgetAmount: p.budgetAmount ? Number(p.budgetAmount) : null,
        contractAmount: p.contractAmount ? Number(p.contractAmount) : null,
      }));
    }

    try {
      const basePayload = {
        date: dayStart.toISOString(),
        currentTime: new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        userContext: user ? { role: user.role, displayName: user.displayName, username: user.username } : undefined,
        chairmanMode: isChairman || undefined,
        projects: allProjects,
      };
      if (relevantItems.length === 0) {
        result = await this.aiService.analyzeWorkArrangementDailyPlan({ ...basePayload, items: [] });
      } else {
        result = await this.aiService.analyzeWorkArrangementDailyPlan({
          ...basePayload,
          items: relevantItems.map((item) => ({
            id: item.id, title: item.title, description: item.description ?? '',
            type: item.type, urgency: item.urgency, status: item.status,
            dueAt: item.dueAt?.toISOString() ?? null,
            reminderAt: item.reminderAt?.toISOString() ?? null,
            estimatedMinutes: item.estimatedMinutes ?? null,
            customTags: normalizeTags(item.customTags),
            project: item.projectManagementItem ? {
              id: item.projectManagementItem.id, title: item.projectManagementItem.title,
              currentStage: item.projectManagementItem.currentStage, status: item.projectManagementItem.status,
            } : null,
            dependencies: item.dependencies.map((dep) => ({
              id: dep.dependsOn.id, title: dep.dependsOn.title, status: dep.dependsOn.status,
            })),
          })),
        });
      }
    } catch (error) {
      console.error('AI daily plan generation failed:', error);
      result = {
        date: dayStart.toISOString(), headerGreeting: '', namePraise: '',
        dailyGreeting: '', riskSummary: '', aiSuggestion: '', overview: '',
        focusItems: [], timeBlocks: [], riskAlerts: [],
        completionAdvice: '', projectBrief: '',
      };
    }

    // 如果 headerGreeting 缓存仍有效，保留旧的
    const finalHeaderGreeting = headerCacheValid ? headerCacheEntry!.headerGreeting : result.headerGreeting;
    const finalNamePraise = headerCacheValid ? headerCacheEntry!.namePraise : result.namePraise;

    if (!headerCacheValid) {
      this.headerGreetingCache.set(userId, {
        headerGreeting: finalHeaderGreeting, namePraise: finalNamePraise,
        itemCount: relevantItems.length, timestamp: now,
      });
    }

    const { headerGreeting: _, namePraise: ___, date: __, ...contentWithoutHeader } = result;
    this.contentCache.set(userId, {
      data: { ...contentWithoutHeader }, itemCount: relevantItems.length, timestamp: now,
    });

    const response = {
      date: dayStart.toISOString(),
      headerGreeting: finalHeaderGreeting,
      namePraise: finalNamePraise,
      ...contentWithoutHeader,
    };

    // 持久化到 DB
    void this.saveDbCachedPlan(userId, today, response as any);

    return response;
  }

  /**
   * 内部方法：强制重新生成每日计划（regenerateDailyPlan 使用）
   * 不检查 DB 缓存，直接走完整 AI 生成流程
   */
  private async buildDailyPlanInternal(
    userId: string, today: string, dayStart: Date, now: number, force: boolean,
  ) {
    // 直接走完整生成（不检查任何缓存）
    const [user, items] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, role: true, displayName: true },
      }),
      this.prisma.workArrangement.findMany({
        where: { userId, status: { notIn: [WorkArrangementStatus.COMPLETED, WorkArrangementStatus.CANCELLED] } },
        orderBy: [{ urgency: 'desc' }, { dueAt: 'asc' }, { updatedAt: 'desc' }],
        include: {
          projectManagementItem: { select: { id: true, title: true, currentStage: true, status: true } },
          dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        },
      }),
    ]);

    const isChairman = user?.username === 'Swhi-CGZX-00';
    const needsProjectBrief = isChairman || user?.role === 'leader' || user?.role === 'admin';
    let allProjects: any[] | undefined;
    if (needsProjectBrief) {
      allProjects = (await this.prisma.projectManagementItem.findMany({
        where: { status: { notIn: [ProjectManagementStatus.ARCHIVED] } },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: { id: true, title: true, currentStage: true, status: true, procurementMethod: true, budgetAmount: true, contractAmount: true, awardedSupplier: true, requesterDepartment: true },
      })).map((p) => ({ ...p, budgetAmount: p.budgetAmount ? Number(p.budgetAmount) : null, contractAmount: p.contractAmount ? Number(p.contractAmount) : null }));
    }

    let result;
    try {
      const basePayload = {
        date: dayStart.toISOString(),
        currentTime: new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        userContext: user ? { role: user.role, displayName: user.displayName, username: user.username } : undefined,
        chairmanMode: isChairman || undefined,
        projects: allProjects,
      };
      if (items.length === 0) {
        result = await this.aiService.analyzeWorkArrangementDailyPlan({ ...basePayload, items: [] });
      } else {
        result = await this.aiService.analyzeWorkArrangementDailyPlan({
          ...basePayload,
          items: items.map((item) => ({
            id: item.id, title: item.title, description: item.description ?? '',
            type: item.type, urgency: item.urgency, status: item.status,
            dueAt: item.dueAt?.toISOString() ?? null,
            reminderAt: item.reminderAt?.toISOString() ?? null,
            estimatedMinutes: item.estimatedMinutes ?? null,
            customTags: normalizeTags(item.customTags),
            project: item.projectManagementItem ? { id: item.projectManagementItem.id, title: item.projectManagementItem.title, currentStage: item.projectManagementItem.currentStage, status: item.projectManagementItem.status } : null,
            dependencies: item.dependencies.map((dep) => ({ id: dep.dependsOn.id, title: dep.dependsOn.title, status: dep.dependsOn.status })),
          })),
        });
      }
    } catch (error) {
      console.error('AI daily plan generation failed:', error);
      result = { date: dayStart.toISOString(), headerGreeting: '', namePraise: '', dailyGreeting: '', riskSummary: '', aiSuggestion: '', overview: '', focusItems: [], timeBlocks: [], riskAlerts: [], completionAdvice: '', projectBrief: '' };
    }

    this.headerGreetingCache.set(userId, { headerGreeting: result.headerGreeting, namePraise: result.namePraise, itemCount: items.length, timestamp: now });
    const { headerGreeting: _, namePraise: ___, date: __, ...contentWithoutHeader } = result;
    this.contentCache.set(userId, { data: { ...contentWithoutHeader }, itemCount: items.length, timestamp: now });

    const response = { date: dayStart.toISOString(), headerGreeting: result.headerGreeting, namePraise: result.namePraise, ...contentWithoutHeader };
    await this.saveDbCachedPlan(userId, today, response as any);
    return response;
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

    const original = new Date(reminderAt);
    const now = new Date();
    // 原提醒时间已过期时，以当前时间为锚点，确保新时间一定在未来
    const anchor = original.getTime() < now.getTime() ? now : original;

    if (dto.preset === 'PLUS_30_MINUTES') {
      return addMinutes(anchor, 30);
    }

    if (dto.preset === 'THIS_AFTERNOON') {
      const target = new Date(anchor);
      target.setHours(15, 0, 0, 0);
      // 如果当天 15:00 已过，推到下一天
      if (target.getTime() <= anchor.getTime()) {
        target.setDate(target.getDate() + 1);
      }
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
