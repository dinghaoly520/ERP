import { Controller, Post, Get, Body, Res, Req, UseGuards, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthGuard } from './auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from './current-user.decorator';
import { cookieNameForPortal, portalForRole, portalFromRequest, LEGACY_COOKIE } from './portal-cookie';

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, maxAge: 7 * 24 * 3600 * 1000 };

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Public()
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
  @ApiOperation({ summary: '用户登录' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const portal = portalFromRequest(req);
    const result = await this.authService.login(dto, portal);
    if (!result) throw new UnauthorizedException('用户名或密码错误');
    const portal = portalForRole(result.role) || portalFromRequest(req);
    res.cookie(portal ? cookieNameForPortal(portal) : LEGACY_COOKIE, result.access_token, COOKIE_OPTS);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '退出登录' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // 清除当前门户的 cookie（按 X-Portal / 来源端口），同时清除旧版 token
    const portal = portalFromRequest(req);
    if (portal) res.clearCookie(cookieNameForPortal(portal));
    res.clearCookie(LEGACY_COOKIE);
    return { ok: true };
  }

  @Get('me')

  @ApiCookieAuth('token')
  @ApiOperation({ summary: '获取当前用户信息' })
  me(@CurrentUser('sub') userId: string) {
    return this.authService.me(userId);
  }
}
