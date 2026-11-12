import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PAIRING_ALLOWED } from './tablet-pairing.scope';
import type { PairingScope } from './tablet-pairing.scope';

/**
 * TAB-SYNC-01 平板配对受限令牌全局守卫（spec §6，注册于 ThrottlerGuard 之后）。
 *
 * - `req.pairingScope` 不存在（全量会话 / Task 4 落地前的所有请求）→ 直接放行，零影响；
 * - scoped 请求默认拒绝：方法 + 去前缀路径（+ /upload 类目）未命中 PAIRING_ALLOWED 任一条
 *   → 403 `PAIRING_SCOPE_FORBIDDEN`；
 * - pid 绑定（guard 层强制，非 UI 过滤）：路径 `/expert/projects/:projectId/…` 捕获的
 *   projectId ≠ `pairingScope.projectId` → 403 `PAIRING_PROJECT_MISMATCH`——先于白名单判定，
 *   双重违规时给出更精确诊断；裸列表 `GET /expert/projects` 与跨项目端点
 *   （/auth/*、/expert/profile*、statistics、tasks）无 pid 参数，天然豁免。
 */
@Injectable()
export class PairingScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const scope = (req as { pairingScope?: PairingScope }).pairingScope;
    // 非 scoped（桌面全量会话；Task 4 落地前全员如此）——守卫 no-op
    if (!scope) return true;

    const method = req.method.toUpperCase();
    const path = stripApiPrefix(typeof req.path === 'string' ? req.path : '');

    // pid 绑定：仅捕获 /expert/projects/<id>/… 形态（裸列表不命中）
    const pidMatch = path.match(PAIRING_PROJECT_PATH_RE);
    if (pidMatch && pidMatch[1] !== scope.projectId) {
      throw new ForbiddenException({
        error: '平板仅可访问已配对项目',
        code: 'PAIRING_PROJECT_MISMATCH',
      });
    }

    const allowed = PAIRING_ALLOWED.some((entry) => {
      if (entry.method.toUpperCase() !== method) return false;
      if (!entry.path.test(path)) return false;
      if (entry.uploadCategory !== undefined) {
        // 类目级放行：req.query.category 须为同值字符串（数组/对象等奇异形态一律拒）
        const raw = (req.query as Record<string, unknown>).category;
        if ((typeof raw === 'string' ? raw : '') !== entry.uploadCategory) return false;
      }
      return true;
    });
    if (!allowed) {
      throw new ForbiddenException({
        error: '平板配对身份无权执行此操作，请在桌面端操作',
        code: 'PAIRING_SCOPE_FORBIDDEN',
      });
    }
    return true;
  }
}

/** `req.path` 实含全局前缀 /api（port-route.guard / operation-log.filter 同口径）——仅剥离该前缀 */
function stripApiPrefix(path: string): string {
  return path === '/api' || path.startsWith('/api/') ? path.slice('/api'.length) : path;
}

/** /expert/projects/:projectId/… 捕获（裸列表 GET /expert/projects 不命中——pid 豁免） */
const PAIRING_PROJECT_PATH_RE = /^\/expert\/projects\/([^/]+)/;
