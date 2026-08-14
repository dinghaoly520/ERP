import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { portalFromRequest } from './portal-cookie';
import { checkPortRouteAccess } from './port-routes';

/**
 * L5 端口-路径白名单守卫
 *
 * 在 AuthGuard（L4）之后执行。检查当前请求的路径是否在"其他端口的独占列表"中：
 * - bid_host 在 :3007 调 /api/supplier/list → 403
 * - leader 在 :3005 调 /api/bid/projects/:id/start-evaluation → 403
 *
 * 公共路径（auth/me、notification 等）不受限。
 * 共享 API（GET /api/bid/projects 列表/详情）也不受限——由 L6 数据过滤处理。
 */
@Injectable()
export class PortRouteGuard implements CanActivate {
  private readonly logger = new Logger(PortRouteGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path;
    const method = req.method;
    const portal = portalFromRequest(req);

    // 未识别门户（直接调 API、WebSocket 等）→ 不拦截
    if (!portal) return true;

    const denial = checkPortRouteAccess(method, path, portal);
    if (denial) {
      this.logger.warn(
        `PortRoute blocked: portal=${portal} ${method} ${path} — ${denial}`,
      );
      throw new ForbiddenException({
        error: denial,
        code: 'PORT_ROUTE_FORBIDDEN',
      });
    }

    return true;
  }
}
