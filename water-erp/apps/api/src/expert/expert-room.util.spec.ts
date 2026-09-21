import { assertRoomUnlocked } from './expert-room.util';

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
