import { announcementCompanyAllows, announcementCompanyWhere, toolCompanyWhere } from './company-filter';
import type { AssistantToolCtx } from './assistant-tool';

const ctx = (user?: AssistantToolCtx['user'], companyIds?: string[]): AssistantToolCtx => ({ user, companyIds });

it('admin 无 companyIds = 全部', () => {
  expect(toolCompanyWhere(ctx({ sub: 'a', role: 'admin', companyId: null }))).toEqual({});
});
it('admin + companyIds = in 集合', () => {
  expect(toolCompanyWhere(ctx({ sub: 'a', role: 'admin', companyId: null }, ['x', 'y'])))
    .toEqual({ companyId: { in: ['x', 'y'] } });
});
it('leader = 本公司', () => {
  expect(toolCompanyWhere(ctx({ sub: 'l', role: 'leader', companyId: 'co-1' }))).toEqual({ companyId: 'co-1' });
});
it('staff 无归属公司 = 永假空集', () => {
  expect(toolCompanyWhere(ctx({ sub: 's', role: 'staff', companyId: null }))).toEqual({ companyId: { in: [] } });
});
it('bid_host = 强制本公司（2026-11-03 对齐 CompanyScopeService：非 admin 一律本公司，此前漏过滤=全平台可见）', () => {
  expect(toolCompanyWhere(ctx({ sub: 'h', role: 'bid_host', companyId: 'co-1' }))).toEqual({ companyId: 'co-1' });
  expect(toolCompanyWhere(ctx({ sub: 'h', role: 'bid_host', companyId: null }))).toEqual({ companyId: { in: [] } });
});
it('匿名/其他角色 = 不加过滤（外层 allowedTools 门禁管住）', () => {
  expect(toolCompanyWhere({})).toEqual({});
});

// ── 公告域口径（2026-11-03 用户裁定：水叮当系统内容同公司隔离）──
describe('announcementCompanyWhere / announcementCompanyAllows', () => {
  it('leader = 本公司 ∪ 平台级（companyId null 恒全员）', () => {
    expect(announcementCompanyWhere(ctx({ sub: 'l', role: 'leader', companyId: 'co-1' })))
      .toEqual({ OR: [{ companyId: 'co-1' }, { companyId: null }] });
    expect(announcementCompanyAllows(ctx({ sub: 'l', role: 'leader', companyId: 'co-1' }), 'co-1')).toBe(true);
    expect(announcementCompanyAllows(ctx({ sub: 'l', role: 'leader', companyId: 'co-1' }), null)).toBe(true);
    expect(announcementCompanyAllows(ctx({ sub: 'l', role: 'leader', companyId: 'co-1' }), 'co-2')).toBe(false);
  });
  it('admin + companyIds = 所选 ∪ 平台级；无 companyIds = 全部', () => {
    expect(announcementCompanyWhere(ctx({ sub: 'a', role: 'admin', companyId: null }, ['x'])))
      .toEqual({ OR: [{ companyId: { in: ['x'] } }, { companyId: null }] });
    expect(announcementCompanyWhere(ctx({ sub: 'a', role: 'admin', companyId: null }))).toEqual({});
  });
  it('staff/bid_host 无归属公司 = 空集（平台级也不放行）', () => {
    expect(announcementCompanyWhere(ctx({ sub: 's', role: 'staff', companyId: null })))
      .toEqual({ companyId: { in: [] } });
    expect(announcementCompanyAllows(ctx({ sub: 's', role: 'staff', companyId: null }), null)).toBe(false);
  });
  it('匿名 = 不过滤（公开可见性由 PUBLIC_WHERE 把关）', () => {
    expect(announcementCompanyWhere({})).toEqual({});
    expect(announcementCompanyAllows(undefined, 'co-any')).toBe(true);
  });
});

describe(':3011 总数据短路（2026-11-03 裁定，评审 F3 补全）', () => {
  const leaderCtx = { user: { sub: 'u1', role: 'leader', companyId: 'co-1' } };
  it('totalData 短路三个判定面——数据 where/公告 where/公告 JS 判定一致', () => {
    const ctx = { ...leaderCtx, totalData: true };
    expect(toolCompanyWhere(ctx)).toEqual({});
    expect(announcementCompanyWhere(ctx)).toEqual({});
    expect(announcementCompanyAllows(ctx, 'other-co')).toBe(true); // 此前漏加：列表能看详情拒绝
  });
  it('不带 totalData 的 leader 维持三面隔离', () => {
    expect(toolCompanyWhere(leaderCtx)).toEqual({ companyId: 'co-1' });
    expect(announcementCompanyAllows(leaderCtx, 'other-co')).toBe(false);
  });
});
