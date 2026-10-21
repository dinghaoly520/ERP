import { assertRoomUnlocked, assertEvaluationStarted } from './expert-room.util';

/**
 * P3-3（2026-09-21 全流程审查）：roomCode 非空而 roomCodeAt 为 NULL（手工改库/数据漂移——
 * 正式写点 startEvaluation/rotateRoomCode 均成对写）时，旧实现要求 `roomVerifiedAt >= roomCodeAt`
 * 恒不成立 → 专家验证成功也永远 403 ROOM_CODE_REQUIRED 死锁。加固口径：roomCodeAt 空时
 * 已验证（roomVerifiedAt 存在）即放行；roomCodeAt 有值时维持轮换失效语义。
 */
const mkPrisma = (project: Record<string, unknown>, expert: Record<string, unknown> | null) => ({
  bidProject: { findUnique: jest.fn().mockResolvedValue(project) },
  bidExpert: { findFirst: jest.fn().mockResolvedValue(expert) },
}) as any;

describe('assertRoomUnlocked — roomCodeAt 空值加固', () => {
  it('roomCode 有 + roomCodeAt NULL + 已验证 → 放行（修复前死锁）', async () => {
    const prisma = mkPrisma({ stage: 'EVALUATING', roomCode: 'AUDIT002', roomCodeAt: null }, { roomVerifiedAt: new Date() });
    await expect(assertRoomUnlocked(prisma, 'p1', 'u1')).resolves.toBeUndefined();
  });

  it('roomCode 有 + roomCodeAt 有值 + roomVerifiedAt 早于轮换 → 403 ROOM_CODE_REQUIRED（轮换失效语义保持）', async () => {
    const prisma = mkPrisma(
      { stage: 'EVALUATING', roomCode: 'AUDIT002', roomCodeAt: new Date('2026-09-21T10:00:00Z') },
      { roomVerifiedAt: new Date('2026-09-21T09:00:00Z') },
    );
    await expect(assertRoomUnlocked(prisma, 'p1', 'u1')).rejects.toMatchObject({ response: { code: 'ROOM_CODE_REQUIRED' } });
  });

  it('roomCode 有 + roomCodeAt 有值 + roomVerifiedAt 晚于轮换 → 放行', async () => {
    const prisma = mkPrisma(
      { stage: 'EVALUATING', roomCode: 'AUDIT002', roomCodeAt: new Date('2026-09-21T09:00:00Z') },
      { roomVerifiedAt: new Date('2026-09-21T10:00:00Z') },
    );
    await expect(assertRoomUnlocked(prisma, 'p1', 'u1')).resolves.toBeUndefined();
  });

  it('roomCode 空（未启用）→ 恒放行（旧行为护栏）', async () => {
    const prisma = mkPrisma({ stage: 'EVALUATING', roomCode: null, roomCodeAt: null }, null);
    await expect(assertRoomUnlocked(prisma, 'p1', 'u1')).resolves.toBeUndefined();
  });
});

describe('assertEvaluationStarted — 评标启动闸（2026-10-21：启动评标前评标资料不裸奔）', () => {
  it('OPENING（开标中，主持人未启动评标）→ 403 EVALUATION_NOT_STARTED', async () => {
    const prisma = mkPrisma({ stage: 'OPENING' }, null);
    await expect(assertEvaluationStarted(prisma, 'p1'))
      .rejects.toMatchObject({ response: { code: 'EVALUATION_NOT_STARTED' } });
  });

  it('EVALUATING → 放行（评标已启动）', async () => {
    const prisma = mkPrisma({ stage: 'EVALUATING' }, null);
    await expect(assertEvaluationStarted(prisma, 'p1')).resolves.toBeUndefined();
  });

  it('ABORTED（流标）→ 放行——镜像口令闸阶段集（P2-6：流标后已进流程专家仍可回看）', async () => {
    const prisma = mkPrisma({ stage: 'ABORTED' }, null);
    await expect(assertEvaluationStarted(prisma, 'p1')).resolves.toBeUndefined();
  });

  it('项目不存在 / 更早阶段（SUBMIT/DOWNLOAD）→ 同 403（未启动即未开始）', async () => {
    await expect(assertEvaluationStarted(mkPrisma(null as any, null), 'p1'))
      .rejects.toMatchObject({ response: { code: 'EVALUATION_NOT_STARTED' } });
    await expect(assertEvaluationStarted(mkPrisma({ stage: 'SUBMIT' }, null), 'p1'))
      .rejects.toMatchObject({ response: { code: 'EVALUATION_NOT_STARTED' } });
  });
});
