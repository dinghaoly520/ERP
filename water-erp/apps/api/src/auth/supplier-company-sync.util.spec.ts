import { planSupplierCompanySync } from './supplier-company-sync.util';

/** 2026-11-04 用户口径：供应商归属公司可为多个——账号管理多选 = 替换 APPROVED 链接集合；
 *  规划纯函数只算 diff（授予以公司 id 计、移除以 APPROVED 链接行计），不碰库。 */
describe('planSupplierCompanySync（供应商多归属替换集规划）', () => {
  const approved = (id: string, companyId: string) => ({ id, companyId, status: 'APPROVED' });

  it('全新授予：目标集无既有 APPROVED → 全部进 grant，主归属=目标首个', () => {
    const r = planSupplierCompanySync([], null, ['co-a', 'co-b']);
    expect(r.grantCompanyIds).toEqual(['co-a', 'co-b']);
    expect(r.removeLinkIds).toEqual([]);
    expect(r.nextPrimaryId).toBe('co-a');
  });

  it('已有 APPROVED 命中目标的不重复授予；目标外 APPROVED 进移除', () => {
    const r = planSupplierCompanySync(
      [approved('l-1', 'co-a'), approved('l-2', 'co-c')],
      'co-a',
      ['co-a', 'co-b'],
    );
    expect(r.grantCompanyIds).toEqual(['co-b']); // co-a 已在库，不重发
    expect(r.removeLinkIds).toEqual(['l-2']); // co-c 被取消勾选
    expect(r.nextPrimaryId).toBe('co-a'); // 主归属仍在集合内，保持不变
  });

  it('主归属被移除 → 改指目标首个；目标空 → 主归属清空', () => {
    expect(
      planSupplierCompanySync([approved('l-1', 'co-a')], 'co-a', ['co-b', 'co-c']).nextPrimaryId,
    ).toBe('co-b');
    expect(planSupplierCompanySync([approved('l-1', 'co-a')], 'co-a', []).nextPrimaryId).toBeNull();
  });

  it('PENDING/DISABLED/REJECTED 链接不在归属集：目标命中则重授予（直批）、不在目标也不移除', () => {
    const links = [
      { id: 'l-p', companyId: 'co-p', status: 'PENDING' },
      { id: 'l-d', companyId: 'co-d', status: 'DISABLED' },
      { id: 'l-r', companyId: 'co-r', status: 'REJECTED' },
    ];
    const r = planSupplierCompanySync(links, null, ['co-p', 'co-d']);
    expect(r.grantCompanyIds).toEqual(['co-p', 'co-d']); // 待审/停用 → 直批恢复
    expect(r.removeLinkIds).toEqual([]); // co-r 未勾选但非 APPROVED，不动（供应商自助申请在途/历史不清理）
  });

  it('目标集去重保序', () => {
    const r = planSupplierCompanySync([], null, ['co-b', 'co-a', 'co-b']);
    expect(r.grantCompanyIds).toEqual(['co-b', 'co-a']);
    expect(r.nextPrimaryId).toBe('co-b');
  });
});
