import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { PmiOwnershipGuard } from './pmi-ownership.guard';

/** 读写分级（2026-10-10 用户裁定）：
 *  读 = 创建人 + 本公司 leader + admin（全部公司）；写 = 仅创建人（leader/admin 对他人项目只读）。 */
describe('PmiOwnershipGuard', () => {
  const mkCtx = (params: Record<string, string>, user: unknown, path = '/api/project-management/pm-1', method = 'GET') =>
    ({ switchToHttp: () => ({ getRequest: () => ({ params, user, path, method }) }) }) as unknown as ExecutionContext;

  const mkGuard = (item: unknown, scopeCompanyId: string) => {
    const prisma = { projectManagementItem: { findUnique: jest.fn().mockResolvedValue(item) } };
    const companyScope = { resolveScope: jest.fn().mockResolvedValue({ all: false, companyId: scopeCompanyId }) };
    return new PmiOwnershipGuard(prisma as never, companyScope as never);
  };

  const PMI = { createdById: 'staff-9', companyId: 'co-a' };

  it('非 :id 路由（列表/创建）不校验直接放行', async () => {
    await expect(mkGuard(PMI, 'co-a').canActivate(mkCtx({}, { sub: 'x-1', role: 'staff' }))).resolves.toBe(true);
  });

  it('项目不存在 → 放行交后续 404 语义', async () => {
    await expect(mkGuard(null, 'co-a').canActivate(mkCtx({ id: 'pm-404' }, { sub: 'staff-1', role: 'staff' }))).resolves.toBe(true);
  });

  // ── 创建人：读写全权 ──

  it('创建人（staff）读放行', async () => {
    await expect(mkGuard(PMI, 'co-z').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'staff-9', role: 'staff' }))).resolves.toBe(true);
  });

  it('创建人（leader）写放行——创建人身份优先于只读视野', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'staff-9', role: 'leader' }, undefined, 'PATCH')),
    ).resolves.toBe(true);
  });

  // ── admin：全部公司可见，但只读 ──

  it('admin 读他人项目放行（全公司）', async () => {
    await expect(mkGuard(PMI, 'co-b').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'root', role: 'admin' }))).resolves.toBe(true);
  });

  it('admin 写他人项目 → 403 PMI_READ_ONLY', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'root', role: 'admin' }, undefined, 'DELETE')),
    ).rejects.toMatchObject({ response: { code: 'PMI_READ_ONLY' } });
  });

  // ── leader：本公司可见，但只读 ──

  it('leader 读本公司他人项目放行', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' })),
    ).resolves.toBe(true);
  });

  it('leader 写本公司他人项目 → 403 PMI_READ_ONLY', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' }, undefined, 'POST')),
    ).rejects.toMatchObject({ response: { code: 'PMI_READ_ONLY' } });
  });

  it('leader 跨公司读 → 403 PMI_OWNERSHIP_FORBIDDEN', async () => {
    await expect(
      mkGuard(PMI, 'co-b').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' })),
    ).rejects.toMatchObject({ response: { code: 'PMI_OWNERSHIP_FORBIDDEN' } });
  });

  it('leader 但项目无公司归属（companyId=null）→ 403（不盲放）', async () => {
    await expect(
      mkGuard({ createdById: 'staff-9', companyId: null }, 'co-a')
        .canActivate(mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── staff：他人项目读写全拒 ──

  it('staff 访问他人项目（读/写）→ 403 PMI_OWNERSHIP_FORBIDDEN（个人隔离不变）', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'staff-1', role: 'staff' })),
    ).rejects.toMatchObject({ response: { code: 'PMI_OWNERSHIP_FORBIDDEN' } });
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'staff-1', role: 'staff' }, undefined, 'POST')),
    ).rejects.toMatchObject({ response: { code: 'PMI_OWNERSHIP_FORBIDDEN' } });
  });

  // ── 端点分级：懒建/分析 ──

  it('GET :id/bid-project（懒建端点）按写口径：非创建人 → PMI_READ_ONLY', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(
        mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' }, '/api/project-management/pm-1/bid-project'),
      ),
    ).rejects.toMatchObject({ response: { code: 'PMI_READ_ONLY' } });
  });

  it('POST :id/analyze（详情面板挂载即调的只读分析）→ 只读视野放行', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(
        mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' }, '/api/project-management/pm-1/analyze', 'POST'),
      ),
    ).resolves.toBe(true);
  });

  it('POST :id/analyze-step / :id/refresh-summary → 只读视野放行', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(
        mkCtx({ id: 'pm-1' }, { sub: 'root', role: 'admin' }, '/api/project-management/pm-1/analyze-step', 'POST'),
      ),
    ).resolves.toBe(true);
    await expect(
      mkGuard(PMI, 'co-a').canActivate(
        mkCtx({ id: 'pm-1' }, { sub: 'root', role: 'admin' }, '/api/project-management/pm-1/refresh-summary', 'POST'),
      ),
    ).resolves.toBe(true);
  });

  it('HEAD 与 GET 同语义（无副作用）→ 只读视野放行', async () => {
    await expect(
      mkGuard(PMI, 'co-a').canActivate(mkCtx({ id: 'pm-1' }, { sub: 'leader-1', role: 'leader' }, undefined, 'HEAD')),
    ).resolves.toBe(true);
  });
});
