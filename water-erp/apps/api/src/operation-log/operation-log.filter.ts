/**
 * 排除模式：
 * - string：路径前缀匹配（任意方法）
 * - RegExp：路径正则匹配（任意方法）
 * - { method, path }：方法限定 + 路径（字符串前缀或正则）——用于「只排除轮询 GET、保留写操作审计」的场景
 */
export type ExcludePattern =
  | string
  | RegExp
  | { method?: string; path: string | RegExp };

/** 确定性噪声：Swagger / socket.io / 健康检查 + 各门户高频轮询端点 */
export const DEFAULT_EXCLUDE_PATHS: ExcludePattern[] = [
  '/api/docs',
  '/api/docs-json',
  '/api-json',
  /^\/socket\.io\//,
  '/api/health',
  '/api/healthz',
  // ── 高频轮询（30s/数秒级心跳式请求，记录只会制造日志膨胀）──
  '/api/notifications/unread-count', // 30s ×3 门户（web/bid-portal/supplier-portal）
  '/api/supplier/stats', // web 驾驶舱 30s
  '/api/catalog/admin/stats', // web 驾驶舱 30s
  '/api/alerts/overview', // web 驾驶舱 30s
  '/api/tender-review/rules/extract/tasks/', // 3s 轮询（该前缀下只有 GET，前缀安全）
  // 以下前缀下有写端点（DELETE/stop/resolve、POST confirm/decline），用方法限定只排除轮询 GET、保留写审计
  { method: 'GET', path: '/api/auth/heartbeat' }, // 15s 单设备登录心跳（AuthGuard 实际校验）
  { method: 'GET', path: '/api/tender-review/review/tasks' }, // 2s 轮询审查任务状态
  { method: 'GET', path: '/api/expert-admin/invitations/' }, // 5s 轮询专家邀请状态
  { method: 'GET', path: '/api/ai-bid-analysis/tasks' }, // 3s/1.5s 轮询分析进度（controller 待补，面向未来）
  { method: 'GET', path: /^\/api\/bid\/projects\/[^/]+\/ai-analysis-progress$/ }, // 3s 轮询 AI 评标进度（:3007 卡片）；同前缀写端点（retry/rerun）保留审计
];

/**
 * 解析 OPERATION_LOG_EXCLUDE 环境变量（逗号分隔）。
 * `/.../flags` 形式识别为正则，其余按字符串前缀匹配。
 * （对象形式仅供代码内默认值使用，env 保持纯字符串配置。）
 */
export function parseExcludePaths(raw?: string): ExcludePattern[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^\/(.+)\/([gimsuy]*)$/);
      if (m) {
        try {
          return new RegExp(m[1], m[2]);
        } catch {
          return part;
        }
      }
      return part;
    });
}

/** 是否应排除记录：非 /api 前缀，或命中任一排除模式（对象模式按 method 限定） */
export function shouldExclude(
  method: string,
  path: string,
  exclude: ExcludePattern[],
): boolean {
  if (!path.startsWith('/api')) return true;
  return exclude.some((p) => {
    if (typeof p === 'string') return path.startsWith(p);
    if (p instanceof RegExp) return p.test(path);
    if (p.method && p.method.toUpperCase() !== method.toUpperCase()) return false;
    return typeof p.path === 'string' ? path.startsWith(p.path) : p.path.test(path);
  });
}
