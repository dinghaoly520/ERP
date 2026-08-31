import { BadRequestException } from '@nestjs/common';
import { ProjectManagementService } from './project-management.service';

/** 拍板 #6（2026-08-27）：立项硬闸——未受理审核通过不得完成 INITIATION 进入采购文件编制 */
describe('updateStage 立项硬闸（INITIATION_NOT_APPROVED）', () => {
  // 构造器 8 参：prisma, gbCode, ai, documentParser, storage, archiveScope, archiveFlow, stageCompliance
  const mkService = (prisma: object, archiveScope?: object) =>
    new ProjectManagementService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      (archiveScope ?? { checkStageGate: jest.fn().mockResolvedValue([]) }) as never,
      {} as never,
      {} as never,
    );

  const stage = { projectManagementStage: { findFirst: jest.fn().mockResolvedValue({ id: 'st-1', stageKey: 'INITIATION' }) } };

  it('未递交（null）→ 拦截', async () => {
    const svc = mkService({ ...stage, projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ currentStage: 'INITIATION', reviewStatus: null }) } });
    await expect(svc.updateStage('pmi-1', 'INITIATION', { status: 'COMPLETED' } as never)).rejects.toMatchObject({
      response: { code: 'INITIATION_NOT_APPROVED' },
    });
  });

  it('待审核（PENDING）→ 拦截', async () => {
    const svc = mkService({ ...stage, projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ currentStage: 'INITIATION', reviewStatus: 'PENDING' }) } });
    await expect(svc.updateStage('pmi-1', 'INITIATION', { status: 'COMPLETED' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('已驳回（REJECTED）→ 拦截', async () => {
    const svc = mkService({ ...stage, projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ currentStage: 'INITIATION', reviewStatus: 'REJECTED' }) } });
    await expect(svc.updateStage('pmi-1', 'INITIATION', { status: 'COMPLETED' } as never)).rejects.toMatchObject({
      response: { code: 'INITIATION_NOT_APPROVED' },
    });
  });

  it('已受理通过（APPROVED）→ 放行（不再抛立项闸错误，进入后续归档范围校验链）', async () => {
    const prisma = {
      ...stage,
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({ currentStage: 'INITIATION', reviewStatus: 'APPROVED' }),
        update: jest.fn().mockResolvedValue({ id: 'pmi-1' }),
      },
      projectManagementStage: { findFirst: jest.fn().mockResolvedValue({ id: 'st-1', stageKey: 'INITIATION' }), findMany: jest.fn().mockResolvedValue([{ stageKey: 'INITIATION', stageOrder: 1 }, { stageKey: 'TENDER_DOCUMENT', stageOrder: 2 }]), update: jest.fn(), updateMany: jest.fn() },
    };
    const svc = mkService(prisma);
    // 闸放行后可能因后续链路 mock 不全而抛其它错——本用例只断言「不是立项闸拦截」
    const err = await svc.updateStage('pmi-1', 'INITIATION', { status: 'COMPLETED' } as never).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toMatchObject({ response: { code: 'INITIATION_NOT_APPROVED' } });
  });
});
