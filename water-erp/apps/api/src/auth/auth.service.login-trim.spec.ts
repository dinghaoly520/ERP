import { hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * 登录用户名 trim（2026-10-27）：登录主查询不 trim 用户名——复制粘贴带来的前后空格
 * 使 findMany({username:' 何全洋'}) 查无此人，回误导性「用户名或密码错误」
 * （:3006 专家门户 8 连 401 实录）。供应商别名分支本就 trim，主查询补齐同口径。
 */
describe('AuthService.login — 用户名前后空格容忍', () => {
  const PW = hashSync('correct-pw', 10);
  const mk = () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', username: '何全洋', role: 'bid_expert', isActive: true, isFrozen: false, passwordHash: PW },
        ]),
      },
      supplier: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new (AuthService as any)(prisma) as AuthService;
    jest.spyOn(svc as any, 'issueToken').mockReturnValue({ access_token: 'tok' });
    return { prisma, svc };
  };

  it('前导/尾随空格 → 按去空格用户名查询且正常登录（不再回 null）', async () => {
    const { prisma, svc } = mk();
    const r = (await svc.login({ username: ' 何全洋 ', password: 'correct-pw' }, 'expert')) as any;
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { username: '何全洋' },
      select: expect.anything(),
    });
    expect(r?.access_token).toBe('tok');
  });

  it('密码不做 trim（空格是口令的一部分，错一位即失败）', async () => {
    const { svc } = mk();
    const r = await svc.login({ username: '何全洋', password: ' correct-pw' }, 'expert');
    expect(r).toBeNull();
  });
});
