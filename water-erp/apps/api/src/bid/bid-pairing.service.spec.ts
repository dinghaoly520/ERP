import { BidPairingService } from './bid-pairing.service';

/**
 * TAB-SYNC-02 P2-4：主持端远程解绑——服务面单测（host 端点经新控制器暴露，
 * 权限闸 AssignedHostGuard 与既有 host 端点同款，不在本 spec 责任面）。
 */

describe('BidPairingService（TAB-SYNC-02 P2-4 主持端远程解绑）', () => {
  const prisma: any = {
    bidExpert: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ displayName: '陈主持' }) },
    bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const registry: any = {
    getActive: jest.fn(),
    revoke: jest.fn(),
  };
  const gateway: any = {
    notifyPairingRevoked: jest.fn(),
    kickPairingSockets: jest.fn(),
  };

  function makeService() {
    return new BidPairingService(prisma, gateway, registry);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ displayName: '陈主持' });
  });

  it('unpairExpert：有活动配对 → revoke + 监督日志（操作人留痕）+ 广播 + 踢除', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1', expertName: '杨睿' });
    registry.getActive.mockResolvedValue({ pairingId: 'jti-1', device: { uaSummary: 'iPad' }, pairedAt: 123 });
    registry.revoke.mockResolvedValue({ projectId: 'p1' });

    const r = await makeService().unpairExpert('p1', 'be1', 'op-user');

    expect(r).toEqual({ ok: true });
    expect(registry.revoke).toHaveBeenCalledWith('jti-1');
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'p1', role: '评审专家', target: '杨睿',
        action: '平板解除配对',
        result: expect.stringContaining('主持端远程解绑'),
      }),
    }));
    expect(gateway.notifyPairingRevoked).toHaveBeenCalledWith('p1', 'be1');
    expect(gateway.kickPairingSockets).toHaveBeenCalledWith('be1');
  });

  it('unpairExpert：无活动配对 → 幂等 ok，不写日志不广播', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be1', expertName: '杨睿' });
    registry.getActive.mockResolvedValue(null);

    expect(await makeService().unpairExpert('p1', 'be1', 'op-user')).toEqual({ ok: true });
    expect(registry.revoke).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    expect(gateway.notifyPairingRevoked).not.toHaveBeenCalled();
  });

  it('unpairExpert：专家不在该项目 → 403 NOT_PROJECT_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(null);
    await expect(makeService().unpairExpert('p1', 'ghost', 'op-user')).rejects.toMatchObject({
      status: 403, response: expect.objectContaining({ code: 'NOT_PROJECT_EXPERT' }),
    });
  });
});
