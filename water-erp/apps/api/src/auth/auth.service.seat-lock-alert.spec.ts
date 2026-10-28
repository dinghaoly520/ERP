import { AuthService } from './auth.service';

/**
 * 工位锁定告警专家名显示（2026-10-28）：alertSeatLockRejection 的输入链（login → issueToken）
 * 只有 username，告警文案与监督日志曾直接嵌登录名——username ≠ 姓名的专家
 * （CSV 导入显式「登录账号」列/管理端录入自定义用户名）在 :3005 通知管理看到的是
 * 账号串而非姓名。修复口径：按 userId 查 displayName 展示「姓名（账号 xxx）」，
 * 查不到回退 username；监督日志 target 同步用展示名（与 expert.service 的
 * target=expertName 口径一致，target 是核验异常等读端的检索键）。
 */
describe('AuthService.alertSeatLockRejection 专家名显示', () => {
  const win = [{ projectId: 'p1', projectName: '项目A' }];

  const makeService = (displayName: string | null, withNotifications = true) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ displayName }),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }]),
      },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };
    const notifications = withNotifications ? { create: jest.fn().mockResolvedValue({}) } : undefined;
    const svc = new AuthService(prisma as any, {} as any, {} as any, undefined, notifications as any);
    return { svc, prisma, notifications };
  };

  it('displayName ≠ username → 通知展示「姓名（账号 xxx）」、监督日志 target=姓名', async () => {
    const { svc, prisma, notifications } = makeService('冯杰');
    await svc.alertSeatLockRejection('u1', 'e2e-rw-wexp', win, '1.2.3.4', 'UA');

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ target: '冯杰' }) }),
    );
    const arg = notifications!.create.mock.calls[0][0];
    expect(arg.content).toContain('「冯杰（账号 e2e-rw-wexp）」');
    expect(arg.content).toContain('评标期间'); // 文案主体不变
  });

  it('displayName 缺失/空白 → 回退登录用户名，不带账号后缀', async () => {
    for (const dn of [null, '   ']) {
      const { svc, notifications } = makeService(dn as string | null);
      await svc.alertSeatLockRejection('u1', 'e2e-rw-wexp', win, '1.2.3.4', 'UA');
      const arg = notifications!.create.mock.calls[0][0];
      expect(arg.content).toContain('「e2e-rw-wexp」');
      expect(arg.content).not.toContain('（账号');
    }
  });

  it('notifications 服务未注入 → 走 prisma.notification.create 同口径', async () => {
    const { svc, prisma } = makeService('冯杰', false);
    await svc.alertSeatLockRejection('u1', 'e2e-rw-wexp', win, '1.2.3.4', 'UA');
    const arg = prisma.notification.create.mock.calls[0][0].data;
    expect(arg.content).toContain('「冯杰（账号 e2e-rw-wexp）」');
  });
});
