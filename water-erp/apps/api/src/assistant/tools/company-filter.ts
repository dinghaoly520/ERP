import type { AssistantToolCtx } from './assistant-tool';

/** 数据工具公司口径（2026-10-22 :3011 P1）：与三页 CompanyScope 同语义。
 *  admin：默认全部，companyIds（ChatDto.context 服务端采纳）多选；
 *  leader/staff：强制本公司（无归属=永假空集，绝不放行全部）；
 *  其他角色/匿名：不加过滤——外层 allowedTools 门禁已限制其只能用公开域工具。 */
export function toolCompanyWhere(ctx?: AssistantToolCtx): { companyId?: string | { in: string[] } } {
  if (!ctx?.user) return {};
  const { role, companyId } = ctx.user;
  if (role === 'admin') {
    return ctx.companyIds?.length ? { companyId: { in: ctx.companyIds } } : {};
  }
  if (role === 'leader' || role === 'staff') {
    return companyId ? { companyId } : { companyId: { in: [] } };
  }
  return {};
}
