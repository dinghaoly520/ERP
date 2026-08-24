import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { tokenFromRequest, portalFromRequest } from './portal-cookie';
import { checkPortRole } from './port-roles';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = tokenFromRequest(req);
    if (!token) throw new UnauthorizedException();
    // 该 token 是否来自 token_web cookie（单设备登录只约束 web 会话）
    const fromWebCookie = (req.cookies as Record<string, string | undefined> | undefined)?.token_web === token;
    try {
      const payload = await this.jwt.verifyAsync(token);
      // 复查用户启用状态：confirmRetire / setAvailability(false) 已置 isActive=false，
      // 此处即时止损，避免退役/停用用户的 JWT 在自然过期前继续有效。
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true, isFrozen: true, webSessionId: true },
      });
      if (!user || !user.isActive) throw new UnauthorizedException();
      // 冻结账号即时止损：已签发的 token 立刻失效，登录端另行提示 ACCOUNT_FROZEN。
      if (user.isFrozen) {
        throw new UnauthorizedException({ error: '该账号已被冻结，请联系管理员', code: 'ACCOUNT_FROZEN' });
      }
      // :3005 单设备登录（2026-08-21）：web 登录签发的 token 自带 sid（tab 级——前端把
      // token 存 sessionStorage 经 X-Web-Token 头携带，同浏览器多账号并存互不覆盖）。
      // sid 与库中 User.webSessionId 不一致 = 该账号已在别处重新登录，本会话被顶下线。
      // 校验依据是 JWT 内 sid 本身（不可通过省略请求头绕过）；无 sid 的 token 属其他
      // 门户或本功能上线前的存量 web 会话——后者（来自 token_web cookie）统一失效重登。
      if (payload.sid) {
        if (payload.sid !== user.webSessionId) {
          throw new UnauthorizedException({ error: '该账号已在其他设备登录，请重新登录', code: 'SESSION_REPLACED' });
        }
      } else if (fromWebCookie) {
        throw new UnauthorizedException({ error: '登录已失效，请重新登录', code: 'SESSION_REPLACED' });
      }
      (req as any).user = payload;

      // L4 运行时角色-端口校验：即使 cookie 被手动伪造，角色与端口不匹配也会 403。
      // 公共端点（login/logout/health）已由 @Public 豁免，不会走到这里。
      const roleCheck = checkPortRole(payload.role, portalFromRequest(req));
      if (roleCheck) {
        throw new ForbiddenException({ error: roleCheck, code: 'PORT_ROLE_MISMATCH' });
      }
    } catch (err) {
      // 带 code 的异常（PORT_ROLE_MISMATCH / SESSION_REPLACED）原样抛出，
      // 其余（JWT 过期/签名错误等）统一归为 401。
      if (err instanceof ForbiddenException || err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException();
    }
    return true;
  }
}
