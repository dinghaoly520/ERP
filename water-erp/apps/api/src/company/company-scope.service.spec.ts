import { ForbiddenException } from '@nestjs/common';
import { CompanyScopeService, CompanyScope, NO_COMPANY, scopeCompanyIds } from './company-scope';

/**
 * 公司隔离引擎多选扩展（2026-10-14）：?companyId=a,b,c 逗号多选语义锁定。
 * - admin：多 id 逐个校验存在，部分无效取有效集、全部无效回退全部；
 * - 非 admin：传参一律忽略（防伪造），强制本人公司；未归属 → 永假空集；
 * - filter()：限定集恒为 in 子句（单选等价）；assertInScope：集合归属判定。
 */
describe('CompanyScopeService 多选扩展（2026-10-14）', () => {
  const admin = { sub: 'u-admin', username: 'a', role: 'admin' } as never;
  const leader = { sub: 'u-leader', username: 'l', role: 'leader' } as never;

  function mk(companies: string[], userCompany?: string | null) {
    return {
      company: {
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.id.in.filter((id: string) => companies.includes(id)).map((id: string) => ({ id })))),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(userCompany === undefined ? { companyId: 'co-own' } : { companyId: userCompany }),
      },
    } as never;
  }

  it('admin 逗号多选：全有效 → 顺序保持的有效集', async () => {
    const svc = new CompanyScopeService(mk(['co-a', 'co-b', 'co-c']));
    const scope = await svc.resolveScope(admin, 'co-c,co-a,co-b,co-a');
    expect(scope).toEqual({ all: false, companyIds: ['co-c', 'co-a', 'co-b'] }); // 去重 + 请求顺序
  });

  it('admin 部分无效：取有效集；全部无效/空 → 回退全部', async () => {
    const svc = new CompanyScopeService(mk(['co-a']));
    expect(await svc.resolveScope(admin, 'co-a,ghost-1')).toEqual({ all: false, companyIds: ['co-a'] });
    expect(await svc.resolveScope(admin, 'ghost-1,ghost-2')).toEqual({ all: true });
    expect(await svc.resolveScope(admin, ',,')).toEqual({ all: true });
    expect(await svc.resolveScope(admin, 'all')).toEqual({ all: true });
  });

  it('admin 单选：等价长度 1 的集合', async () => {
    const svc = new CompanyScopeService(mk(['co-a']));
    expect(await svc.resolveScope(admin, 'co-a')).toEqual({ all: false, companyIds: ['co-a'] });
  });

  it('非 admin：多选传参一律忽略，强制本人公司；未归属 → 永假空集', async () => {
    const svc = new CompanyScopeService(mk(['co-a', 'co-b']));
    expect(await svc.resolveScope(leader, 'co-a,co-b')).toEqual({ all: false, companyIds: ['co-own'] });
    const orphan = new CompanyScopeService(mk([], null));
    expect(await orphan.resolveScope(leader, 'co-a')).toEqual({ all: false, companyIds: [NO_COMPANY] });
  });

  it('filter()：限定集恒 in 子句（单选等价）；all → 空 where', () => {
    const svc = new CompanyScopeService(mk([]));
    expect(svc.filter({ all: false, companyIds: ['a', 'b'] })).toEqual({ companyId: { in: ['a', 'b'] } });
    expect(svc.filter({ all: false, companyIds: ['a'] })).toEqual({ companyId: { in: ['a'] } });
    expect(svc.filter({ all: true })).toEqual({});
  });

  it('assertInScope：集合内放行、集合外/无归属 403；all 全放行', () => {
    const svc = new CompanyScopeService(mk([]));
    const scope: CompanyScope = { all: false, companyIds: ['co-a', 'co-b'] };
    expect(() => svc.assertInScope('co-a', scope)).not.toThrow();
    expect(() => svc.assertInScope('co-b', scope)).not.toThrow();
    expect(() => svc.assertInScope('co-c', scope)).toThrow(ForbiddenException);
    expect(() => svc.assertInScope(null, scope)).toThrow(ForbiddenException);
    expect(() => svc.assertInScope('co-z', { all: true })).not.toThrow();
  });

  it('scopeCompanyIds：all → null；限定 → id 列表（直读者统一出口）', () => {
    expect(scopeCompanyIds({ all: true })).toBeNull();
    expect(scopeCompanyIds({ all: false, companyIds: ['x'] })).toEqual(['x']);
  });
});
