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
 * 校验通知链接是否可跳转：
 * - 应用内路径：须命中 :3005 已知路由（防 404）
 * - 绝对外链（http/https）：放行——跨门户跳转是有意能力（如任务通知中心
 *   强制以 portalURL('bid') 绝对地址跳 :3007 开评标端，新标签打开非本应用路由）
 * @returns 可跳转时返回原 link（含 query）；不可跳转（空/占位串/未知内链）返回 null
 */
export function resolveNotificationLink(link?: string | null): string | null {
  if (!link) return null;
  const trimmed = link.trim();
  if (!trimmed || trimmed === '链接') return null; // '链接' 为后端占位串（非路由）
  if (/^https?:\/\//i.test(trimmed)) return trimmed; // 绝对外链：跨门户跳转
  if (trimmed.startsWith('//') || !trimmed.startsWith('/')) return null; // 协议相对/非路径
  const path = trimmed.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const hit =
    KNOWN_EXACT_ROUTES.has(path) ||
    KNOWN_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return hit ? trimmed : null;
}

/**
 * 通知链接统一执行器（与 resolveNotificationLink 同口径）：
 * - 应用内合法路由 → router.push
 * - 绝对外链 → window.open 新标签（noopener，与 notification-click 原语义一致）
 * - 不可跳转 → no-op（仅保留通知能力）
 * @returns 是否实际执行了跳转
 */
export function openNotificationLink(
  link: string | null | undefined,
  router: { push: (path: string) => void },
): boolean {
  const target = resolveNotificationLink(link);
  if (!target) return false;
  if (/^https?:\/\//i.test(target)) {
    window.open(target, '_blank', 'noopener');
  } else {
    router.push(target);
  }
  return true;
}
