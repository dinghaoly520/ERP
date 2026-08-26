import { Controller, Post, Get, Patch, Body, Query, Param, Res, Req, HttpCode, HttpStatus, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnyRole } from '../common/decorators/any-role.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { getClientIp } from '../common/client-ip.util';
import { cookieNameForPortal, portalForRole, portalFromRequest, tokenFromRequest, LEGACY_COOKIE } from './portal-cookie';
import { checkPortRole } from './port-roles';
import { PORTS } from '@water-erp/config';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// secure 标志环境门控：仅 production 生效，保证 dev/e2e（NODE_ENV=test）在 http 下仍可登录。
// path 固定 '/'，登出 clearCookie 须传同样 opts 才能匹配删除浏览器 cookie。
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: IS_PRODUCTION,
  // 不设 domain：cookie 自动限定为当前请求来源 host。
  // 开发环境可通过 localhost 或 192.168.x.x 访问，各端口 cookie 天然共享（RFC 6265 不区分端口）。
  // 若指定 domain='localhost'，平板通过 192.168.1.111 访问时浏览器会拒绝存储 cookie。
  path: '/',
  maxAge: 7 * 24 * 3600 * 1000,
};

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '注册新用户（需管理员审核）' })
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);
    // 注册后返回 { pending: true }，不签发 token、不设 cookie —— 管理员审核通过后才能登录
    return result;
  }

  @Get('companies')
  @Public()
  @ApiOperation({ summary: '已知公司列表（注册下拉建议，Company 主数据）' })
  async companies() {
    // 2026-08-20 起改查 Company 主数据表（数据隔离的归属单位），新公司注册时自动建档。
    // 返回保持纯名称数组——注册 datalist 直接回填，须与 normalizeCompany 的对齐键一致。
    const rows = await this.prisma.company.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(r => r.name);
  }

  @Post('users/:id/approve')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '审核通过注册用户' })
  async approveUser(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.approveUser(id, { id: user.sub, name: user.username });
  }

  @Post('users/:id/reject')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '拒绝注册用户' })
  async rejectUser(
    @Param('id') id: string,
    @Body() body: { note?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.rejectUser(id, { id: user.sub, name: user.username }, body?.note);
  }

  @Get('registration-reviews')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '注册审核历史（只读）' })
  async registrationReviews() {
    return this.authService.listRegistrationReviews();
  }

  @Get('pending-registrations')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '待审核注册用户列表' })
  async pendingRegistrations() {
    return this.authService.listPendingRegistrations();
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '用户登录' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const requestPortal = portalFromRequest(req);
    let result = await this.authService.login(dto, requestPortal);
    if (!result) throw new UnauthorizedException('用户名或密码错误');
    // 待审核/停用账号：密码正确但不可登录，返回专用码供前端引导「查询审核进度」。
    // pending 变体为字面量 pending:true，用 'pending' in result 判别即可让 TS 正确收窄类型。
    if ('pending' in result) {
      // ACCOUNT_PENDING：待审核/停用；TEMPORARY_EXPIRED：临时供应商邀请码有效期已过；
      // ACCOUNT_FROZEN：管理员冻结
      const msg =
        result.code === 'TEMPORARY_EXPIRED' ? '临时供应商有效期已过，请联系采购中心'
        : result.code === 'ACCOUNT_FROZEN' ? '该账号已被冻结，请联系管理员'
        : '账号待审核，尚未激活';
      throw new UnauthorizedException({ error: msg, code: result.code });
    }

    // L3 端口-角色强绑定：角色不允许在当前端口登录 → 403
    const roleCheck = checkPortRole(result.role, requestPortal);
    if (roleCheck) {
      throw new ForbiddenException({ error: roleCheck, code: 'PORT_ROLE_MISMATCH' });
    }

    let cookiePortal = portalForRole(result.role) || portalFromRequest(req);

    // :3006 登录分流：非 bid_expert 角色都写 token_bid（跳 :3007）
    // bid_expert 写 token_expert（留在 :3006）
    if (requestPortal === 'expert' && result.role !== 'bid_expert') {
      cookiePortal = 'bid';
    }

    // :3005 单设备登录（2026-08-21）：凡是最终写入 token_web 命名空间的登录（无论从
    // :3005 还是 :3002 入口）都轮换会话 ID 并重签带 sid 的 token——后登录者顶掉先登录者。
    // 写 token_bid/token_expert/token_mall 等其他门户的登录不轮换、不互踢。
    if (cookiePortal === 'web') {
      result = await this.authService.rotateWebSession(result.userId, result.username, result.role);
    }
    res.cookie(cookiePortal ? cookieNameForPortal(cookiePortal) : LEGACY_COOKIE, result.access_token, COOKIE_OPTS);

    // Write login audit log
    const ip = getClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    await this.prisma.auditLog.create({
      data: {
        userId: result.userId,
        action: 'LOGIN',
        resourceType: 'auth',
        resourceId: result.userId,
        details: { role: result.role },
        ipAddress: ip,
        userAgent,
      },
    });

    return { access_token: result.access_token, role: result.role, username: result.username };
  }

  @Post('security-feedback')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '被顶下线设备反馈「账号被他人登录」，通知管理员处理' })
  async securityFeedback(@Req() req: Request) {
    // 被顶下线的旧会话 JWT 签名仍有效（仅会话标识过期）——用它确认反馈人身份
    let username = '未知账号';
    const token = tokenFromRequest(req);
    if (token) {
      try {
        const payload = this.jwt.verify(token) as { username?: string };
        if (payload?.username) username = payload.username;
      } catch { /* 签名无效则保留兜底文案 */ }
    }
    await this.authService.notifySecurityFeedback(
      username,
      getClientIp(req),
      (req.headers['user-agent'] as string) ?? null,
    );
    return { ok: true };
  }

  @Get('heartbeat')
  @AnyRole()
  @ApiOperation({ summary: '单设备登录心跳：会话被顶替/账号冻结时返回 401，由前端踢回登录页' })
  heartbeat() {
    // 实际校验在全局 AuthGuard；本端点仅为前端提供轻量轮询目标（操作日志已排除）
    return { ok: true };
  }

  @Post('logout')
  @AnyRole()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '退出登录' })
  async logout(@CurrentUser('sub') userId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Write logout audit log
    const ip = getClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        resourceType: 'auth',
        resourceId: userId,
        details: {},
        ipAddress: ip,
        userAgent,
      },
    });

    // 清除当前门户的 cookie（按 X-Portal / 来源端口），同时清除旧版 token。
    // clearCookie 须传与 set 一致的 path/secure/sameSite，浏览器才会匹配删除。
    const portal = portalFromRequest(req);
    if (portal) res.clearCookie(cookieNameForPortal(portal), COOKIE_OPTS);
    res.clearCookie(LEGACY_COOKIE, COOKIE_OPTS);
    return { ok: true };
  }

  @Get('me')
  @AnyRole()
  @ApiCookieAuth('token')
  @ApiOperation({ summary: '获取当前用户信息' })
  me(@CurrentUser('sub') userId: string) {
    return this.authService.me(userId);
  }

  @Patch('me')
  @Roles('admin')
  @ApiOperation({ summary: '更新当前用户个人资料（仅 admin 运维通道；普通用户一律走 /auth/profile-change-requests 审批）' })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    const updated = await this.authService.updateProfile(userId, dto);

    // Write audit log
    const changedFields = Object.keys(dto).filter(
      (k) => dto[k as keyof UpdateProfileDto] !== undefined,
    );
    if (changedFields.length > 0) {
      const ip = getClientIp(req);
      const userAgent = (req.headers['user-agent'] as string) ?? null;
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'PROFILE_UPDATE',
          resourceType: 'user',
          resourceId: userId,
          details: { changedFields },
          ipAddress: ip,
          userAgent,
        },
      });
    }

    return updated;
  }

  @Get('me/login-history')
  @AnyRole()
  @ApiOperation({ summary: '获取当前用户的登录历史（最近20条）' })
  async loginHistory(@CurrentUser('sub') userId: string) {
    return this.prisma.auditLog.findMany({
      where: { userId, action: 'LOGIN' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  @Get('sso/mall')
  @Public()
  @ApiOperation({ summary: '从管理端 SSO 免登录进入采购商城（新标签页）' })
  async ssoToMall(
    @Req() req: Request,
    @Query('redirect_uri') redirectUri: string,
    @Res() res: Response,
  ) {
    // 手动解析 token_web cookie（不依赖 AuthGuard，新标签页跨端口时 cookie domain=localhost 携带但 AuthGuard 不适用）
    let currentUserId: string | undefined;
    const tokenWeb = req.cookies?.token_web;
    if (tokenWeb) {
      try {
        const payload = this.jwt.verify(tokenWeb) as { sub: string };
        if (payload?.sub) currentUserId = payload.sub;
      } catch { /* token 无效则降级，直接跳转不做 SSO */ }
    }

    // 白名单校验 redirect_uri，防止开放重定向
    // （SSO_ALLOWED_REDIRECTS：环境追加的可信商城地址，逗号分隔）
    // mall 门户 origin 由 @water-erp/config 的 PORTS 派生（审计 D：原硬编码 :3003）；
    // 生产经 MALL_URL 环境变量补充真实域名。
    const mallOrigin = `http://localhost:${PORTS.mall}`;
    const ALLOWED_REDIRECTS = new Set([
      mallOrigin,
      ...(process.env.MALL_URL ? [process.env.MALL_URL] : []),
      ...(process.env.SSO_ALLOWED_REDIRECTS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
    ]);
    if (redirectUri && !ALLOWED_REDIRECTS.has(redirectUri)) {
      throw new BadRequestException({ error: '非法重定向地址', code: 'INVALID_REDIRECT' });
    }
    const mallRedirect = redirectUri || mallOrigin;

    if (currentUserId) {
      const currentUser = await this.prisma.user.findUnique({
        where: { id: currentUserId },
        select: { username: true },
      });
      if (currentUser) {
        const mallUser = await this.prisma.user.findFirst({
          where: { username: currentUser.username, role: 'mall', isActive: true },
          select: { id: true, username: true },
        });
        if (mallUser) {
          const token = this.authService.issueToken(mallUser.id, mallUser.username, 'mall');
          const mallCookieName = cookieNameForPortal('mall') || 'token_mall';
          res.cookie(mallCookieName, token.access_token, COOKIE_OPTS);
          return res.redirect(mallRedirect);
        }
      }
    }

    // 降级：无 token / 无 mall 账户 → 直接跳转商城首页，用户在商城自行登录
    return res.redirect(mallRedirect);
  }

  @Get('departments')
  @AnyRole()
  @ApiOperation({ summary: '获取部门列表（下拉选择用）' })
  async listDepartments() {
    return this.prisma.department.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
}
