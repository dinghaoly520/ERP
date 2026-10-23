import { resolveToolCtx, pickAdminCompanyIds } from './assistant.service';

describe('工具上下文解析', () => {
  it('认证用户解析出 companyId（prisma 单查）', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'co-1' }) } };
    const ctx = await resolveToolCtx(prisma, { userId: 'u1', role: 'leader' }, undefined);
    expect(ctx.user).toEqual({ sub: 'u1', role: 'leader', companyId: 'co-1' });
  });
  it('匿名访客 ctx 为空对象', async () => {
    const prisma: any = { user: { findUnique: jest.fn() } };
    const ctx = await resolveToolCtx(prisma, { guestKey: 'g' }, undefined);
    expect(ctx).toEqual({});
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('context.companyIds 仅 admin 采纳，非 admin 忽略', () => {
    expect(pickAdminCompanyIds(['a', 'b', 3], 'admin')).toEqual(['a', 'b']);
    expect(pickAdminCompanyIds(['a'], 'leader')).toBeUndefined();
  });
});
