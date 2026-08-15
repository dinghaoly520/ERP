/**
 * 端口-路径白名单：定义各端口独占的 API 路径。
 *
 * 一个路径如果匹配某个端口的 EXCLUSIVE 正则，则**只允许该端口访问**，
 * 其他端口的请求会被 PortRouteGuard 拦截（403）。
 *
 * 设计原则：
 * - 公共路径（auth/me、user-settings、notification 等）默认共享
 * - :3005 独占 = 管理类接口（公告/供应商/专家/目录/项目/文档）
 * - :3007 独占 = 现场执行类接口（开标/解密/评标/评分/异议/签字）
 * - 共享 API（如 GET /api/bid/projects 列表/详情）不拦——靠 L6 数据过滤
 * - 例外清单：:3007 现场评标所需的个别只读端点虽挂在 :3005 独占模块下，
 *   仍放行（BID_ALLOWED_WITHIN_WEB_EXCLUSIVE，端点自身 @Roles 已含 bid_host）
 *
 * 用正则而非前缀：能精确区分 /api/bid/projects（共享）vs /api/bid/projects/:id/start-evaluation（独占）
 */

/** 所有端口都能访问的公共路径前缀 */
export const PUBLIC_ROUTE_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/me',
  '/api/auth/departments',
  '/api/auth/password-change-requests',
  '/api/auth/password-reset-requests',
  '/api/user-settings',
  '/api/notification',
  '/api/operation-log',
  '/api/badge',
  '/api/chat',
  '/api/upload',
  '/api/health',
];

/** :3005 采购管理端独占路径（:3007 调用 → 403）—— 用前缀匹配即可，这些都是完整的功能模块 */
export const WEB_EXCLUSIVE_PREFIXES = [
  '/api/announcement',
  '/api/supplier',
  '/api/expert-admin',
  '/api/catalog',
  '/api/project-management',
  '/api/work-arrangements',
  '/api/tender-write',
  '/api/tender-review',
  '/api/tender-sample',
  '/api/tender-history',
  '/api/budget',
  '/api/audit-log',
  '/api/procurements',
  '/api/progress',
  '/api/imports',
  '/api/dashboard',
  '/api/search',
  '/api/system-config',
  '/api/knowledge',
  '/api/review',
  '/api/rules',
  '/api/ai/',
  '/api/ai-bid-analysis',
  '/api/contacts',
  '/api/supplier-portal',
];

/** :3007 开评标端独占路径（:3005 调用 → 403）—— 用正则精确匹配，不误伤共享的 projects 列表 */
export const BID_EXCLUSIVE_PATTERNS: RegExp[] = [
  // 开标会话管理
  /^\/api\/bid\/opening-sessions/,
  /^\/api\/bid\/opening-hall/,
  // 开标大厅操作：/api/bid/projects/:id/{action}
  /^\/api\/bid\/projects\/[^/]+\/decrypt/,
  /^\/api\/bid\/projects\/[^/]+\/songs/,
  /^\/api\/bid\/projects\/[^/]+\/hall-messages/,
  /^\/api\/bid\/projects\/[^/]+\/hall-read-cursors/,
  /^\/api\/bid\/projects\/[^/]+\/supervision/,
  /^\/api\/bid\/projects\/[^/]+\/complete-opening/,
  // 评标执行操作
  /^\/api\/bid\/projects\/[^/]+\/start-evaluation/,
  /^\/api\/bid\/projects\/[^/]+\/evaluation/,
  /^\/api\/bid\/projects\/[^/]+\/scores/,
  /^\/api\/bid\/projects\/[^/]+\/score-records/,
  /^\/api\/bid\/projects\/[^/]+\/score-deltas/,
  /^\/api\/bid\/projects\/[^/]+\/clarifications/,
  /^\/api\/bid\/projects\/[^/]+\/disputes/,
  /^\/api\/bid\/projects\/[^/]+\/result/,
  // 评标签字包（写操作独占；基础 GET 共享——:3005 归档块展示签字闸门/回流状态，
  // controller 该 GET 的 @Roles 已放 leader/staff，见 bid-sign-packet.controller.ts）
  /^\/api\/bid\/sign/,
  /^\/api\/bid\/projects\/[^/]+\/sign-packet\//,
];

/**
 * :3007 现场端在 :3005 独占模块内的例外路径（评标现场所需的只读端点）。
 * 端点自身的 @Roles（admin/bid_host/leader/staff）仍生效，此处只豁免端口层。
 */
export const BID_ALLOWED_WITHIN_WEB_EXCLUSIVE: RegExp[] = [
  // 专家批注/墨迹查看（评标管理 tab；expert-admin.controller.ts:237,248）
  /^\/api\/expert-admin\/projects\/[^/]+\/memos/,
];

/**
 * 判断请求路径是否对给定门户可用。
 * 返回 null 表示放行，返回字符串表示拒绝原因。
 */
export function checkPortRouteAccess(
  method: string,
  path: string,
  portal: string | undefined,
): string | null {
  if (!portal) return null;

  // 公共路径放行
  if (PUBLIC_ROUTE_PREFIXES.some(p => path.startsWith(p))) return null;

  // :3007 (bid) 调用 :3005 独占路径 → 拒绝（评标现场所需的个别只读端点例外）
  if (portal === 'bid' && WEB_EXCLUSIVE_PREFIXES.some(p => path.startsWith(p))) {
    if (BID_ALLOWED_WITHIN_WEB_EXCLUSIVE.some(re => re.test(path))) return null;
    return '该接口仅在采购管理端(:3005)可用';
  }

  // :3005 (web) 调用 :3007 独占路径 → 拒绝
  if (portal === 'web' && BID_EXCLUSIVE_PATTERNS.some(re => re.test(path))) {
    return '该操作仅在开评标管理端(:3007)可用';
  }

  return null;
}
