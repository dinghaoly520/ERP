import { NotFoundException } from '@nestjs/common';
import { TenderReviewController } from './tender-review.controller';
import { computeDraftFingerprint } from './services/draft-fingerprint.util';

function buildController(prisma: any) {
  const controller = new TenderReviewController(
    prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any,
  );
  jest.spyOn(controller as any, 'runReview').mockResolvedValue(undefined);
  return controller;
}

const USER = { sub: 'u1', role: 'staff' } as any;
const KB = { id: 'kb-1', ownerId: 'u1', isShared: true };

describe('TenderReviewController.executeReview（项目扩展）', () => {
  it('带 projectId 时校验项目存在，不存在抛 404', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const controller = buildController(prisma);
    await expect(
      controller.executeReview(
        { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', objectKey: 'k', projectId: 'p-nope', fingerprint: 'f' } as any,
        'c', 'n.docx', 'k', USER,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('带 projectId 时落库关联+指纹并记忆默认知识库', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ id: 'p-1' }) },
      reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-1' }) },
      userSettings: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const controller = buildController(prisma);
    const res = await controller.executeReview(
      { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', objectKey: 'k', projectId: 'p-1', fingerprint: 'fp-1' } as any,
      'c', 'n.docx', 'k', USER,
    );
    expect(res).toEqual({ taskId: 't-1', status: 'running' });
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p-1', draftFingerprint: 'fp-1' }),
    });
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { defaultReviewKbId: 'kb-1' } }),
    );
  });

  it('不带 projectId 时不查项目、不写默认库记忆', async () => {
    const prisma: any = {
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB) },
      projectManagementItem: { findUnique: jest.fn() },
      reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-2' }) },
      userSettings: { upsert: jest.fn() },
    };
    const controller = buildController(prisma);
    await controller.executeReview(
      { knowledgeBaseId: 'kb-1', reviewMode: 'general', documentContent: 'c', documentName: 'n.docx', objectKey: 'k' } as any,
      'c', 'n.docx', 'k', USER,
    );
    expect(prisma.projectManagementItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled();
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: null, draftFingerprint: null }),
    });
  });
});

describe('TenderReviewController.projectStatus（四态）', () => {
  const ANSWERS = { a: '1' };
  // 指纹用真实 util 算期望值，防硬编码漂移
  const FP = computeDraftFingerprint('OPEN', ANSWERS);

  it('无任务 → none', async () => {
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(null) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('none');
    expect(res.fingerprint).toBe(FP);
    expect(res.task).toBeUndefined();
  });

  it('最新任务 running → running', async () => {
    const task = { id: 't-1', status: 'running' };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(task) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('running');
    expect(res.task).toBe(task);
  });

  it('completed 且指纹一致 → matching', async () => {
    const task = { id: 't-1', status: 'completed', draftFingerprint: FP };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(task) } };
    const controller = buildController(prisma);
    const res = await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any);
    expect(res.state).toBe('matching');
  });

  it('completed 但指纹不符 / 最新为 failed → stale（前端按 task.status 细分）', async () => {
    const mismatch = { id: 't-1', status: 'completed', draftFingerprint: 'other' };
    const prisma: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(mismatch) } };
    const controller = buildController(prisma);
    expect((await controller.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any)).state).toBe('stale');

    const failed = { id: 't-2', status: 'failed', draftFingerprint: FP };
    const prisma2: any = { reviewTask: { findFirst: jest.fn().mockResolvedValue(failed) } };
    const controller2 = buildController(prisma2);
    expect((await controller2.projectStatus({ projectId: 'p-1', documentType: 'OPEN', answers: ANSWERS } as any)).state).toBe('stale');
  });
});
