/**
 * 通知链接路由闸（2026-10-23 用户口径：通知跳转禁止 404/报错——目标不存在时只保留通知能力）。
 *
 * 背景：通知 link 由注册表/后端各域写入，部分指向其他门户的路径（:3007 的 /bid、
 * :3004 的 /profile/ukey）或不存在的页面（/contracts、/objections、/prequal…），
 * 在 :3005 点击即 404。本模块按 :3005 app/(main) 实际路由做前缀校验：
 * 未命中 → 调用方不渲染跳转按钮、不 push，仅展示通知内容。
 *
 * 维护约定：新增 (main) 路由时同步补 PREFIXES；动态段（/supplier/[id] 等）
 * 按父前缀匹配天然覆盖。
 */

/**
 * :3005 已知路由（app/(main) 目录树口径，2026-10-23 盘点）：
 * - PREFIX：有子路由的目录，前缀匹配（含动态段 /supplier/[id] 等）
 * - EXACT：仅 page.tsx 无子路由——精确匹配（防 /profile/ukey 这类未知子路径放行 404）
 */
const KNOWN_ROUTE_PREFIXES = [
  '/admin',
  '/expert',
  '/mall-management',
  '/notice',
  '/supplier',
] as const;

const KNOWN_EXACT_ROUTES = new Set([
  '/',
  '/archive',
  '/assistant',
  '/clar-notice',
  '/company-info',
  '/dashboard',
  '/notifications',
  '/procurements',
  '/profile',
  '/progress',
  '/projects',
  '/tender-review',
  '/tender-write',
  '/work-arrangements',
  '/workflow',
]);

/**
 * 校验通知链接是否为本门户可跳转路由。
 * @returns 可跳转时返回原 link（含 query）；不可跳转（外链/未知路由/空）返回 null
 */
export function resolveNotificationLink(link?: string | null): string | null {
  if (!link) return null;
  const trimmed = link.trim();
  if (!trimmed || trimmed === '链接') return null; // '链接' 为后端占位串（非路由）
  // 外链不属于 :3005 应用内跳转（通知链接均为应用内路径）
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) return null;
  // 相对锚点/非路径串不跳
  if (!trimmed.startsWith('/')) return null;
  const path = trimmed.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const hit =
    KNOWN_EXACT_ROUTES.has(path) ||
    KNOWN_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return hit ? trimmed : null;
}
