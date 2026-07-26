import { Controller, Post, Get, Patch, Body, Res, Req, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from './current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { getClientIp } from '../common/client-ip.util';
import { cookieNameForPortal, portalForRole, portalFromRequest, LEGACY_COOKIE } from './portal-cookie';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// secure 标志环境门控：仅 production 生效，保证 dev/e2e（NODE_ENV=test）在 http 下仍可登录。
// path 固定 '/'，登出 clearCookie 须传同样 opts 才能匹配删除浏览器 cookie。
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: IS_PRODUCTION,
  path: '/',
  maxAge: 7 * 24 * 3600 * 1000,
};

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '注册新用户' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    // cookie 名按用户所属门户命名，回退到请求来源门户，再回退到旧版 token
    const portal = portalForRole(result.role) || portalFromRequest(req);
    res.cookie(portal ? cookieNameForPortal(portal) : LEGACY_COOKIE, result.access_token, COOKIE_OPTS);
    return result;
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '用户登录' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const requestPortal = portalFromRequest(req);
    const result = await this.authService.login(dto, requestPortal);
    if (!result) throw new UnauthorizedException('用户名或密码错误');
    // 待审核/停用账号：密码正确但不可登录，返回专用码供前端引导「查询审核进度」。
    // pending 变体为字面量 pending:true，用 'pending' in result 判别即可让 TS 正确收窄类型。
    if ('pending' in result) {
      // ACCOUNT_PENDING：待审核/停用；TEMPORARY_EXPIRED：临时供应商邀请码有效期已过
      const msg = result.code === 'TEMPORARY_EXPIRED' ? '临时供应商有效期已过，请联系采购中心' : '账号待审核，尚未激活';
      throw new UnauthorizedException({ error: msg, code: result.code });
    }
    const cookiePortal = portalForRole(result.role) || portalFromRequest(req);
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

  @Post('logout')
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

  @ApiCookieAuth('token')
  @ApiOperation({ summary: '获取当前用户信息' })
  me(@CurrentUser('sub') userId: string) {
    return this.authService.me(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: '更新当前用户个人资料' })
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
  @ApiOperation({ summary: '获取当前用户的登录历史（最近20条）' })
  async loginHistory(@CurrentUser('sub') userId: string) {
    return this.prisma.auditLog.findMany({
      where: { userId, action: 'LOGIN' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  @Get('departments')
  @ApiOperation({ summary: '获取部门列表（下拉选择用）' })
  async listDepartments() {
    return this.prisma.department.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
}
