export type ExcludePattern = string | RegExp;

/** 确定性噪声：Swagger / socket.io / 健康检查 */
export const DEFAULT_EXCLUDE_PATHS: ExcludePattern[] = [
  '/api/docs',
  '/api/docs-json',
  '/api-json',
  /^\/socket\.io\//,
  '/api/health',
  '/api/healthz',
];

/**
 * 解析 OPERATION_LOG_EXCLUDE 环境变量（逗号分隔）。
 * `/.../flags` 形式识别为正则，其余按字符串前缀匹配。
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

/** 是否应排除记录：非 /api 前缀，或命中任一排除模式 */
export function shouldExclude(path: string, exclude: ExcludePattern[]): boolean {
  if (!path.startsWith('/api')) return true;
  return exclude.some((p) => (typeof p === 'string' ? path.startsWith(p) : p.test(path)));
}
