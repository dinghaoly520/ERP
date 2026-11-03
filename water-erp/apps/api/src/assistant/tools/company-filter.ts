import type { AssistantToolCtx } from './assistant-tool';

/** 数据工具公司口径（2026-10-22 :3011 P1；2026-11-03 与 CompanyScopeService 对齐补齐
 *  bid_host）：非 admin 一律强制本人公司（无归属=永假空集，绝不放行全部）——此前只过滤
 *  leader/staff，bid_host（属 INTERNAL_ROLES，门禁放行数据工具）漏过滤=全平台可见。
 *  admin：默认全部，companyIds（ChatDto.context 服务端采纳）多选；
 *  其他角色/匿名：不加过滤——外层 allowedTools 门禁已限制其只能用公开域工具。 */
export function toolCompanyWhere(ctx?: AssistantToolCtx): { companyId?: string | { in: string[] } } {
  if (!ctx?.user) return {};
  const { role, companyId } = ctx.user;
  if (role === 'admin') {
    return ctx.companyIds?.length ? { companyId: { in: ctx.companyIds } } : {};
  }
  if (role === 'leader' || role === 'staff' || role === 'bid_host') {
    return companyId ? { companyId } : { companyId: { in: [] } };
  }
  return {};
}

/** 公告域公司口径（2026-11-03 用户裁定：水叮当获取的系统内容同公司隔离）：管理端公告
 *  按归属公司隔离，平台级公告（companyId null）全员可见——非 admin（leader/staff/
 *  bid_host）=本公司∪平台级；admin=全部（companyIds 多选时=所选∪平台级）；匿名=不过滤
 *  （可见性由公开域 where 把关）。返回 where 片段，与 toolCompanyWhere 的差异仅在
 *  平台级 null 恒放行。 */
export function announcementCompanyWhere(ctx?: AssistantToolCtx): Record<string, unknown> {
  if (!ctx?.user) return {};
  const { role, companyId } = ctx.user;
  if (role === 'admin') {
    return ctx.companyIds?.length
      ? { OR: [{ companyId: { in: ctx.companyIds } }, { companyId: null }] }
      : {};
  }
  if (role === 'leader' || role === 'staff' || role === 'bid_host') {
    return companyId
      ? { OR: [{ companyId }, { companyId: null }] }
      : { companyId: { in: [] } };
  }
  return {};
}

/** 公告 detail（findUnique 直查旁路收口）：JS 侧公司归属判定，与 announcementCompanyWhere 同口径 */
export function announcementCompanyAllows(ctx: AssistantToolCtx | undefined, annCompanyId: string | null): boolean {
  if (!ctx?.user) return true;
  const { role, companyId } = ctx.user;
  if (role === 'admin') {
    return !ctx.companyIds?.length || annCompanyId === null || ctx.companyIds.includes(annCompanyId);
  }
  if (role === 'leader' || role === 'staff' || role === 'bid_host') {
    if (!companyId) return false;
    return annCompanyId === null || annCompanyId === companyId;
  }
  return true;
}
