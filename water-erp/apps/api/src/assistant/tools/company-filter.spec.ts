import { toolCompanyWhere } from './company-filter';
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
it('匿名/其他角色 = 不加过滤（外层 allowedTools 门禁管住）', () => {
  expect(toolCompanyWhere({})).toEqual({});
});
