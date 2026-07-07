import { Controller, Post, Get, Patch, Body, Res, Req, UseGuards, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthGuard } from './auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from './current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { cookieNameForPortal, portalForRole, portalFromRequest, LEGACY_COOKIE } from './portal-cookie';

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, maxAge: 7 * 24 * 3600 * 1000 };

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

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
    const requestPortal = portalFromRequest(req);
    const result = await this.authService.login(dto, requestPortal);
    if (!result) throw new UnauthorizedException('用户名或密码错误');
    const cookiePortal = portalForRole(result.role) || portalFromRequest(req);
    res.cookie(cookiePortal ? cookieNameForPortal(cookiePortal) : LEGACY_COOKIE, result.access_token, COOKIE_OPTS);

    // Write login audit log
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
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
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null;
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

  @Patch('me')
  @ApiOperation({ summary: '更新当前用户个人资料' })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.authService.updateProfile(userId, dto);

    // Write audit log
    const changedFields = Object.keys(dto).filter(
      (k) => dto[k as keyof UpdateProfileDto] !== undefined,
    );
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'PROFILE_UPDATE',
        resourceType: 'user',
        resourceId: userId,
        details: { changedFields },
      },
    });

    return updated;
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
