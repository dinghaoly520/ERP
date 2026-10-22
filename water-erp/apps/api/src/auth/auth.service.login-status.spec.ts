import { hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * 登录态细化（2026-10-22 bug）：已退库专家（isActive=false + ExpertProfile RETIRED/retiredAt）
 * 登录须回 ACCOUNT_RETIRED，不得误报「账号待审核，尚未激活」——与注册待审（ACCOUNT_PENDING）分流。
 * 对照先例：supplier TEMPORARY_EXPIRED 的角色专属细化码。
 */
describe('AuthService.login — 未激活账号状态分流', () => {
  const PW = hashSync('correct-pw', 10);
  const mk = (user: any, profile: any | null) => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', username: '张三', role: 'bid_expert', isActive: user.isActive, isFrozen: false, passwordHash: PW },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      expertProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
      },
      supplier: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { prisma, svc: new (AuthService as any)(prisma) as AuthService };
  };

  it('已退库专家（entryStatus=RETIRED）→ ACCOUNT_RETIRED（非 ACCOUNT_PENDING）', async () => {
    const { prisma, svc } = mk({ isActive: false }, { entryStatus: 'RETIRED', retiredAt: new Date() });
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.pending).toBe(true);
    expect(r.code).toBe('ACCOUNT_RETIRED');
    expect(prisma.expertProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { entryStatus: true, retiredAt: true },
    });
  });

  it('存量退库（仅 retiredAt 非空、entryStatus 漏写）→ ACCOUNT_RETIRED（retiredAt 兜底口径同恢复路径）', async () => {
    const { svc } = mk({ isActive: false }, { entryStatus: null, retiredAt: new Date() });
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('ACCOUNT_RETIRED');
  });

  it('注册待审专家（无档案/entryStatus=PENDING）→ 维持 ACCOUNT_PENDING（现状不变）', async () => {
    const { svc } = mk({ isActive: false }, { entryStatus: 'PENDING', retiredAt: null });
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('ACCOUNT_PENDING');
  });

  it('专家档案为 null（尚未建档的待审）→ 维持 ACCOUNT_PENDING', async () => {
    const { svc } = mk({ isActive: false }, null);
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('ACCOUNT_PENDING');
  });

  it('冻结优先级不受影响：激活+冻结 → ACCOUNT_FROZEN', async () => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u1', username: '张三', role: 'bid_expert', isActive: true, isFrozen: true, passwordHash: PW },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      supplier: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new (AuthService as any)(prisma) as AuthService;
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('ACCOUNT_FROZEN');
  });
});
