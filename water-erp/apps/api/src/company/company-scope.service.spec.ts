import { ForbiddenException } from '@nestjs/common';
import { CompanyScopeService, CompanyScope, NO_COMPANY, scopeCompanyIds, normalizeCompanyName } from './company-scope';

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

  // :3011 总数据（2026-11-04 门户级落地）：来源头 mobile-3011 + 内部角色 → 全库视野
  it('mobile-3011 来源头：leader/staff/bid_host 放开为全库（无显式公司筛选）', async () => {
    const svc = new CompanyScopeService(mk([]));
    for (const role of ['leader', 'staff', 'bid_host']) {
      const who = { sub: 'u-1', username: 'x', role } as never;
      expect(await svc.resolveScope(who, undefined, 'mobile-3011')).toEqual({ all: true });
      // 传参忽略语义保留（移动端无公司选择器，传参视为噪声）
      expect(await svc.resolveScope(who, 'co-a', 'mobile-3011')).toEqual({ all: true });
    }
  });

  it('mobile-3011 来源头：admin 不受影响（走选择器分支）、外部角色不放开、其余来源头维持隔离', async () => {
    const svc = new CompanyScopeService(mk(['co-a']));
    expect(await svc.resolveScope(admin, undefined, 'mobile-3011')).toEqual({ all: true }); // admin 本就全库
    const supplier = { sub: 'u-2', username: 's', role: 'supplier' } as never;
    expect((await svc.resolveScope(supplier, undefined, 'mobile-3011')).all).toBe(false); // 外部角色不放开
    expect((await svc.resolveScope(leader, undefined, undefined)).all).toBe(false); // 无头=隔离
    expect((await svc.resolveScope(leader, undefined, 'web')).all).toBe(false); // 其他来源=隔离
  });

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

/**
 * resolveCompanyRecord —「改公司全链路联动」唯一收口（2026-11-06 用户裁定）：
 * company 显示名与 companyId 真归属必须成对变更，注册/账号管理//auth/me/资料变更审批
 * 四路同源解析。匹配规则：精确（忽略大小写/空白）→ 去后缀模糊（有限/股份/集团）→ 原样建档。
 */
describe('resolveCompanyRecord — 公司名归一化统一收口（2026-11-06）', () => {
  const known = ['四川省水利发展集团有限公司', '四川水发勘测设计研究有限公司', '四川水发建设有限公司'];

  function mk() {
    const upsert = jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: `id-of:${where.name}`, name: where.name }));
    const prisma = {
      company: {
        findMany: jest.fn().mockResolvedValue(known.map(name => ({ name }))),
        upsert,
      },
    } as never;
    return { svc: new CompanyScopeService(prisma), upsert };
  }

  it('精确匹配（含空白变体）→ 沿用主数据规范名，不新建档', async () => {
    const { svc, upsert } = mk();
    const rec = await svc.resolveCompanyRecord(' 四川水发建设有限公司 ');
    expect(rec).toEqual({ id: 'id-of:四川水发建设有限公司', name: '四川水发建设有限公司' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: '四川水发建设有限公司' }, update: {} }));
  });

  it('去后缀模糊匹配：「四川水发建设」→ 四川水发建设有限公司（漏写后缀对齐规范名）', async () => {
    const { svc } = mk();
    const rec = await svc.resolveCompanyRecord('四川水发建设');
    expect(rec.name).toBe('四川水发建设有限公司');
  });

  it('空白公司名 → 400 拒绝（防 \' \' 绕过 DTO IsNotEmpty 建档空名公司）', async () => {
    const { svc, upsert } = mk();
    await expect(svc.resolveCompanyRecord('   ')).rejects.toMatchObject({
      status: 400,
      response: { code: 'COMPANY_NAME_REQUIRED' },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('未命中主数据 → 以原名建档（upsert create 分支）', async () => {
    const { svc, upsert } = mk();
    const rec = await svc.resolveCompanyRecord('全新某某公司');
    expect(rec.name).toBe('全新某某公司');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { name: '全新某某公司' } }));
  });

  it('normalizeCompanyName 纯函数：大小写不敏感、空格折叠、后缀剥离键一致', () => {
    expect(normalizeCompanyName('acme', ['ACME'])).toBe('ACME'); // 大小写不敏感（空白为删除语义非折叠）
    expect(normalizeCompanyName('四川水发投资有限公司', ['四川水发投资集团'])).toBe('四川水发投资集团');
    expect(normalizeCompanyName('孤本名称', [])).toBe('孤本名称');
  });
});
