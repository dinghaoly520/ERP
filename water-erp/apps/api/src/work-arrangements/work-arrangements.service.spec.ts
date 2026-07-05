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
    };

    (prisma as Record<string, unknown>).$transaction = jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    prisma.workArrangement.findFirst.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      title: '完成答疑',
      description: null,
      type: 'FOLLOW_UP',
      urgency: 'HIGH',
      status: 'TODO',
      dueAt: new Date('2026-05-13T10:00:00.000Z'),
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
          reminderAt: new Date('2026-05-13T09:00:00.000Z'),
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
});
