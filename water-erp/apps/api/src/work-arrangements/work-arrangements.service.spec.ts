import { BadRequestException } from '@nestjs/common';
import { WorkArrangementsService } from './work-arrangements.service';

describe('WorkArrangementsService', () => {
  const makeService = () => {
    const aiService = {
      analyzeWorkArrangementDailyPlan: jest.fn(),
    };

    // Build the non-transactional mock first, then attach $transaction
    // referencing it — avoids TS7022/TS7024 self-referential initializer
    // errors that arise when $transaction is part of the object literal.
    const prisma = {
      workArrangement: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      workArrangementDependency: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      workArrangementNote: {
        create: jest.fn(),
      },
      workArrangementTemplate: {
        findFirst: jest.fn(),
      },
      projectManagementItem: {
        findUnique: jest.fn(),
      },
      workArrangementDailyPlanCache: {
        upsert: jest.fn(),
      },
    };

    (prisma as Record<string, unknown>).$transaction = jest.fn(
       
      async (callback: (tx: any) => unknown) => callback(prisma),
    );

    const service = new WorkArrangementsService(
      prisma as never,
      aiService as never,
    );
    return { service, prisma, aiService };
  };

  it('builds workbench summary counts from active items', async () => {
    const { service, prisma } = makeService();

    prisma.workArrangement.findMany.mockResolvedValue([
      {
        id: 'todo-1',
        title: '完成答疑',
        description: null,
        type: 'FOLLOW_UP',
        urgency: 'HIGH',
        status: 'TODO',
        dueAt: new Date('2026-05-13T09:00:00.000Z'),
        reminderAt: new Date('2026-05-13T08:30:00.000Z'),
        estimatedMinutes: 30,
        isAllDay: false,
        customTags: [],
        recurrence: 'NONE',
        completionSummary: null,
        reflectionSummary: null,
        completedAt: null,
        createdAt: new Date('2026-05-12T08:00:00.000Z'),
        updatedAt: new Date('2026-05-13T08:00:00.000Z'),
        projectManagementItem: null,
        template: null,
        notes: [],
        dependencies: [],
      },
      {
        id: 'blocked-1',
        title: '提交归档',
        description: null,
        type: 'ARCHIVE',
        urgency: 'CRITICAL',
        status: 'BLOCKED',
        dueAt: new Date('2026-05-12T09:00:00.000Z'),
        reminderAt: new Date('2026-05-12T08:30:00.000Z'),
        estimatedMinutes: 20,
        isAllDay: false,
        customTags: [],
        recurrence: 'NONE',
        completionSummary: null,
        reflectionSummary: null,
        completedAt: null,
        createdAt: new Date('2026-05-12T08:00:00.000Z'),
        updatedAt: new Date('2026-05-12T08:00:00.000Z'),
        projectManagementItem: null,
        template: null,
        notes: [],
        dependencies: [],
      },
      {
        id: 'progress-1',
        title: '整理会议纪要',
        description: null,
        type: 'WRITING',
        urgency: 'MEDIUM',
        status: 'IN_PROGRESS',
        dueAt: new Date('2026-05-14T09:00:00.000Z'),
        reminderAt: null,
        estimatedMinutes: 50,
        isAllDay: false,
        customTags: [],
        recurrence: 'NONE',
        completionSummary: null,
        reflectionSummary: null,
        completedAt: null,
        createdAt: new Date('2026-05-12T08:00:00.000Z'),
        updatedAt: new Date('2026-05-13T07:00:00.000Z'),
        projectManagementItem: null,
        template: null,
        notes: [],
        dependencies: [],
      },
    ]);

    await expect(
      service.buildWorkbenchSummary('user-1', '2026-05-13T08:00:00.000Z'),
    ).resolves.toMatchObject({
      todoCount: 1,
      inProgressCount: 1,
      dueTodayCount: 1,
      riskCount: 1,
    });
  });

  it('postpones a reminder by preset minutes without changing other fields', async () => {
    const { service, prisma } = makeService();

    // 提醒时间设为未来 1 小时，确保「原提醒未过期」→ 锚点为原提醒时间（不依赖真实当前时间，测试确定性）
    const baseReminder = new Date(Date.now() + 60 * 60 * 1000);
    const expectedReminder = new Date(baseReminder.getTime() + 30 * 60 * 1000);

    prisma.workArrangement.findFirst.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      title: '完成答疑',
      description: null,
      type: 'FOLLOW_UP',
      urgency: 'HIGH',
      status: 'TODO',
      dueAt: new Date('2026-05-13T10:00:00.000Z'),
      reminderAt: baseReminder,
      estimatedMinutes: 30,
      isAllDay: false,
      customTags: [],
      recurrence: 'NONE',
      completionSummary: null,
      reflectionSummary: null,
      completedAt: null,
      createdAt: new Date('2026-05-12T08:00:00.000Z'),
      updatedAt: new Date('2026-05-13T08:00:00.000Z'),
      notes: [],
      template: null,
      projectManagementItem: null,
      dependencies: [],
    });
    prisma.workArrangement.update.mockResolvedValue({ id: 'task-1' });

    await service.postponeReminder('user-1', 'task-1', {
      preset: 'PLUS_30_MINUTES',
    });

    expect(prisma.workArrangement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          reminderAt: expectedReminder,
        }),
      }),
    );
  });

  it('rejects postponing when the task has no reminderAt and no custom target', async () => {
    const { service, prisma } = makeService();

    prisma.workArrangement.findFirst.mockResolvedValue({
      id: 'task-2',
      userId: 'user-1',
      title: '整理纪要',
      description: null,
      type: 'WRITING',
      urgency: 'MEDIUM',
      status: 'TODO',
      dueAt: null,
      reminderAt: null,
      estimatedMinutes: null,
      isAllDay: true,
      customTags: [],
      recurrence: 'NONE',
      completionSummary: null,
      reflectionSummary: null,
      completedAt: null,
      createdAt: new Date('2026-05-12T08:00:00.000Z'),
      updatedAt: new Date('2026-05-13T08:00:00.000Z'),
      notes: [],
      template: null,
      projectManagementItem: null,
      dependencies: [],
    });

    await expect(
      service.postponeReminder('user-1', 'task-2', {
        preset: 'PLUS_30_MINUTES',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('后台刷新持久化的每日计划保留 dailyQuote（问候续句不再被字段清单漏掉）', async () => {
    const { service, prisma } = makeService();
    const upsert = prisma.workArrangementDailyPlanCache.upsert;
    upsert.mockResolvedValue({});

    jest.spyOn(service as any, 'loadPlanContext').mockResolvedValue({
      user: { username: 'Swhi-CGZX-01', role: 'leader', displayName: '采购中心领导 02' },
      items: [],
      isChairman: false,
      allProjects: [],
    });
    jest.spyOn(service as any, 'generatePlanResult').mockResolvedValue({
      date: '2026-11-09T16:00:00.000Z',
      headerGreeting: '今天有2项工作需要你关注。',
      namePraise: '',
      dailyGreeting: '',
      riskSummary: '风险可控',
      aiSuggestion: '',
      overview: '共2项任务',
      focusItems: [],
      timeBlocks: [],
      riskAlerts: [],
      completionAdvice: '',
      projectBrief: '',
      dailyQuote: '日头偏西，把最后几件事收干净再走。',
    });

    (service as any).refreshPlanInBackground('user-1', '2026-11-10', new Date('2026-11-10T00:00:00Z'), Date.now());
    // fire-and-forget：轮询刷新锁（finally 中 delete）直至内部 promise 完成
    for (let i = 0; i < 200 && (service as any).dbRefreshLocks.size > 0; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }

    expect(upsert).toHaveBeenCalledTimes(1);
    const persisted = upsert.mock.calls[0][0].create.plan;
    expect(persisted.dailyQuote).toBe('日头偏西，把最后几件事收干净再走。');
    expect(persisted.headerGreeting).toBe('今天有2项工作需要你关注。');
  });
});
