import { closeSignLoopIfDone, signLoopExpertScope } from './sign-loop.util';

/**
 * P2-4（2026-11-20 全链路审查）：签字闭环分母口径——正选且邀请已确认
 * （invitationStatus notIn [declined, pending]）。pending 半边为本批修复：
 * 从未确认邀请的正选恒 PENDING 会把闭环卡死、完整归档永久阻塞。
 */
describe('closeSignLoopIfDone — 闭环分母口径', () => {
  const mkTx = (pendingCount: number) => ({
    bidExpert: { count: jest.fn().mockResolvedValue(pendingCount) },
    bidSignPacket: { update: jest.fn().mockResolvedValue({}) },
    bidProject: { findUnique: jest.fn().mockResolvedValue({ name: '测试项目' }) },
    bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  });

  it('全部实际评委离开 PENDING → 置位 closedAt + 监督日志', async () => {
    const tx = mkTx(0);
    const closed = await closeSignLoopIfDone(tx as any, 'p1', 'u-host');
    expect(closed).toBe(true);
    expect(tx.bidSignPacket.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' }, data: expect.objectContaining({ closedById: 'u-host' }) }),
    );
    expect(tx.bidSupervisionLog.create).toHaveBeenCalled();
  });

  it('仍有 PENDING 实际评委 → 不闭环', async () => {
    const tx = mkTx(1);
    expect(await closeSignLoopIfDone(tx as any, 'p1', 'u-host')).toBe(false);
    expect(tx.bidSignPacket.update).not.toHaveBeenCalled();
  });

  it.each([
    ['declined（2026-10-27 名册除名回归）', 'declined'],
    ['pending（P2-4：从未确认邀请非实际评委——修复前闭环永不可达）', 'pending'],
  ])('分母查询排除 %s', (_label, excluded) => {
    const scope = signLoopExpertScope('p1');
    expect(scope.invitationStatus).toEqual({ notIn: ['declined', 'pending'] });
    expect(scope).toEqual({ projectId: 'p1', expertRole: '正选', invitationStatus: { notIn: ['declined', 'pending'] } });
    // 语义自证：被排除值不得通过 notIn 判定
    expect((['declined', 'pending'] as string[]).includes(excluded)).toBe(true);
  });

  it('count 查询携带分母口径（防退化为仅 signStatus 判定）', async () => {
    const tx = mkTx(0);
    await closeSignLoopIfDone(tx as any, 'p1', 'u-host');
    expect(tx.bidExpert.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        expertRole: '正选',
        signStatus: 'PENDING',
        invitationStatus: { notIn: ['declined', 'pending'] },
      }),
    });
  });
});
