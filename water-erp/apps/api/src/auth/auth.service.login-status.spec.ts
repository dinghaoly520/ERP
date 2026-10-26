import { hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * 登录态细化（2026-10-22 bug + 2026-10-26 补口）：专家侧三分终局——
 * 退库（RETIRED/retiredAt）→ ACCOUNT_RETIRED；停用（availability=停用，setAvailability/
 * 批量停用置 isActive=false 且不写退库字段）→ EXPERT_DISABLED；其余 → EXPERT_INACTIVE。
 * 专家入库无需审核（建档即 isActive=true），任何专家未激活态都不得回 ACCOUNT_PENDING
 * 「账号待审核，尚未激活」。对照先例：supplier TEMPORARY_EXPIRED 的角色专属细化码。
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
      select: { entryStatus: true, retiredAt: true, availability: true },
    });
  });

  it('存量退库（仅 retiredAt 非空、entryStatus 漏写）→ ACCOUNT_RETIRED（retiredAt 兜底口径同恢复路径）', async () => {
    const { svc } = mk({ isActive: false }, { entryStatus: null, retiredAt: new Date() });
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('ACCOUNT_RETIRED');
  });

  it('已停用专家（单个停用/批量停用同态：availability=停用、entryStatus 仍 ACTIVE）→ EXPERT_DISABLED', async () => {
    const { prisma, svc } = mk({ isActive: false }, { entryStatus: 'ACTIVE', availability: '停用', retiredAt: null });
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.pending).toBe(true);
    expect(r.code).toBe('EXPERT_DISABLED');
    expect(prisma.expertProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { entryStatus: true, retiredAt: true, availability: true },
    });
  });

  it('entryStatus=PENDING 专家（入库审核是档案维度，账号建档即激活）→ EXPERT_INACTIVE，不再误报待审核', async () => {
    const { svc } = mk({ isActive: false }, { entryStatus: 'PENDING', availability: '可用', retiredAt: null });
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('EXPERT_INACTIVE');
  });

  it('专家档案为 null（残缺态兜底）→ EXPERT_INACTIVE，不说「账号待审核」', async () => {
    const { svc } = mk({ isActive: false }, null);
    const r = (await svc.login({ username: '张三', password: 'correct-pw' }, 'expert')) as any;
    expect(r.code).toBe('EXPERT_INACTIVE');
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

/** 供应商状态细化（2026-10-22 审计）：停用/黑名单/驳回壳/退回补正 与注册待审分流——
 *  停用与拉黑联动 User.isActive=false（updateStatus），此前一律误报「账号待审核」。 */
describe('AuthService.login — 供应商未激活状态分流', () => {
  const PW = hashSync('correct-pw', 10);
  const mkSup = (supplier: any | null) => {
    const prisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u2', username: '某供应商', role: 'supplier', isActive: false, isFrozen: false, passwordHash: PW },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      supplier: {
        findFirst: jest.fn().mockResolvedValue(null), // 别名反查不命中
        findUnique: jest.fn().mockResolvedValue(supplier),
      },
    };
    return { prisma, svc: new (AuthService as any)(prisma) as AuthService };
  };
  const cases: Array<[string, any, string]> = [
    ['停用', { status: 'DISABLED' }, 'ACCOUNT_DISABLED'],
    ['黑名单', { status: 'BLACKLIST' }, 'ACCOUNT_BLACKLISTED'],
    ['驳回壳', { status: 'REJECTED' }, 'SUPPLIER_REJECTED'],
    ['退回补正', { status: 'RETURNED' }, 'SUPPLIER_RETURNED'],
    ['注册待审', { status: 'PENDING' }, 'ACCOUNT_PENDING'],
  ];
  it.each(cases)('供应商 %s → %s', async (_label, supplier, code) => {
    const { prisma, svc } = mkSup(supplier);
    const r = (await svc.login({ username: '某供应商', password: 'correct-pw' }, 'supplier')) as any;
    expect(r.pending).toBe(true);
    expect(r.code).toBe(code);
    expect(prisma.supplier.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u2' },
      select: { status: true },
    });
  });
  it('供应商无档案（异常态）→ 维持 ACCOUNT_PENDING 兜底', async () => {
    const { svc } = mkSup(null);
    const r = (await svc.login({ username: '某供应商', password: 'correct-pw' }, 'supplier')) as any;
    expect(r.code).toBe('ACCOUNT_PENDING');
  });
});
