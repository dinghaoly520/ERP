import { Controller, Post, Get, Patch, Body, Query, Param, Res, Req, HttpCode, HttpStatus, UnauthorizedException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ExpertTransferClaimDto } from '../expert/dto/expert-transfer.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnyRole } from '../common/decorators/any-role.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { getClientIp } from '../common/client-ip.util';
import { buildSessionMeta } from '../common/session-device.util';
import { cookieNameForPortal, portalForRole, portalFromRequest, tokenFromRequest, LEGACY_COOKIE } from './portal-cookie';
import { checkPortRole } from './port-roles';
import { ROLE_PORTAL } from '@water-erp/config';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// secure 仅 production 生效（dev/e2e http 可登录）；path 固定 '/'，登出 clearCookie 须同 opts。
// domain 默认不设（host-only）——RFC 6265 不分端口，localhost 各门户端口天然共享，指定
// 'localhost' 会拒 IP 访问；生产 *.scsfjt.com 必设 COOKIE_DOMAIN=.scsfjt.com（跨子域 cookie 是
// :3006 分流写 token_bid、WS 带凭据的前提）。登出引用同一常量镜像一致。
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN?.trim() || undefined;

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: IS_PRODUCTION,
  domain: COOKIE_DOMAIN,
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

  @Get('companies/options')
  @Public()
  @ApiOperation({ summary: '公司选项（id+name，供应商注册选择归属公司用）' })
  async companyOptions() {
    return this.prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('users/:id/approve')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '审核通过注册用户（可覆盖申请权限）' })
  async approveUser(
    @Param('id') id: string,
    @Body() dto: { role?: 'management' | 'office' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.approveUser(id, { id: user.sub, name: user.username }, dto?.role);
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
  // 限流 env 可调（默认 10/min）：单设备登录 e2e（test/setup-throttle.ts）需连续多次登录
  @Throttle({ default: { limit: Number(process.env.THROTTLE_LOGIN_LIMIT ?? 10), ttl: Number(process.env.THROTTLE_TTL_MS ?? 60000) } })
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
        : result.code === 'TEMP_ACCOUNT_EXPIRED' ? '临时账号未生效或已随项目结束失效（项目归档/流标后不再可用），请联系采购中心'
        : result.code === 'ACCOUNT_FROZEN' ? '该账号已被冻结，请联系管理员'
        : result.code === 'ACCOUNT_RETIRED' ? '该专家已退库停用，如需恢复请联系管理单位'
        : result.code === 'EXPERT_DISABLED' ? '该专家已被停用，如需恢复请联系管理单位'
        : result.code === 'EXPERT_INACTIVE' ? '该专家账号未启用，请联系管理单位'
        : result.code === 'ACCOUNT_DISABLED' ? '该供应商已被停用，如有疑问请联系采购中心'
        : result.code === 'ACCOUNT_BLACKLISTED' ? '该供应商已被列入黑名单，如有疑问请联系采购中心'
        : result.code === 'SUPPLIER_REJECTED' ? '注册申请未通过审核，可在注册页修改资料后重新提交'
        : result.code === 'SUPPLIER_RETURNED' ? '注册资料已退回补正，请在注册页完成补正后重新提交'
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

    // X-P1-01（2026-09-29 审查修复）：admin 从公共门户（或任意非 web 门户）登录后按
    // ROLE_PORTAL 落地 :3007（bid-portal proxy 只读 token_bid）——cookie 写 web 命名空间
    // 会落地即 401 被弹回 :3006 重登（七角色唯独 admin 的「公共登录→角色门户」链路断裂）。
    // admin 明确从 :3005（requestPortal==='web'）登录保持 token_web（账号管理等管理功能在 :3005）。
    if (result.role === 'admin' && requestPortal !== 'web' && ROLE_PORTAL[result.role] === 'bid') {
      cookiePortal = 'bid';
    }

    // 闸4 工位锁定（2026-09-20 spec）：评标窗口开（签到起→报告确认止）期间，专家账号新登录
    // 一律 409 拒绝（先占不可抢占——冒名者连顶替机会都没有，真专家会话不可被踢）。
    // 解锁阀门=主持人 release-login-lock（清 webSessionId）或本人确认评审报告（窗口闭合）。
    // 检查在会话轮换之前：被拒登录不得影响当前有效会话。
    if (result.role === 'bid_expert' && cookiePortal === 'expert') {
      const seat = await this.authService.checkExpertSeatLock(result.userId);
      if (seat.locked) {
        // P1-3（2026-09-21 审查修复）：拒绝同时四路告警（监督日志高风险 + admin 站内信）
        await this.authService.alertSeatLockRejection(
          result.userId, result.username, seat.windows, getClientIp(req), (req.headers['user-agent'] as string) ?? null,
        );
        throw new ConflictException({
          error: `评标期间账号已锁定（项目【${seat.projectNames.join('、')}】评标未结束），如需更换设备请联系主持人解除锁定`,
          code: 'ACCOUNT_EVALUATING',
        });
      }
    }

    // 单设备登录（web 2026-08-21；supplier 2026-09-18；expert 2026-09-20）：凡最终写
    // token_web/token_supplier/token_expert 的登录都轮换会话 ID 重签带 sid token——后者顶前者；
    // 写 token_bid 等不轮换不互踢（:3006 分流写 token_bid 仅非 bid_expert，不误伤 :3007）。
    if (cookiePortal === 'web' || cookiePortal === 'supplier' || cookiePortal === 'expert') {
      // 设备快照随会话轮换同写（2026-09-22）：IP/UA 分类后的「当前在线设备」供主持人侧展示
      result = await this.authService.rotatePortalSession(
        result.userId, result.username, result.role,
        buildSessionMeta((req.headers['user-agent'] as string) ?? null, getClientIp(req)),
      );
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

  /* ══ 工位迁移领取（2026-09-22 修正方案）：票据（免闸4）+ 密码重证 → 会话轮换到平板 ══
   * 刻意不进 login 路径的闸4 工位锁定（同人迁移非新登录）；成功 Set-Cookie token_expert，
   * 桌面旧 token 随 sid 轮换自然 401 SESSION_REPLACED。 */
  @Post('expert-transfer/claim')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '工位迁移领取：迁移码（单次 90s）+ 登录密码重证 → 会话轮换至当前设备' })
  async claimExpertTransfer(
    @Body() dto: ExpertTransferClaimDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.claimExpertTransfer(dto, {
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] as string) ?? null,
    }) as { access_token: string; role: string; username: string; projectId: string; photoRequired: boolean };
    // 与登录同款 cookie 轨（命名空间 expert；localhost 各端口共享 cookie 域）
    res.cookie(cookieNameForPortal('expert'), result.access_token, COOKIE_OPTS);
    return { access_token: result.access_token, role: result.role, username: result.username, projectId: result.projectId, photoRequired: result.photoRequired };
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

    // 登出即吊销（2026-09-18；X-P1-02 2026-09-29 修正）：仅带 sid 的 token（web/supplier/expert
    // 单设备命名空间）才清会话 ID——token_bid 无 sid 不清，:3007 登出若清此列会误杀同账号
    // :3005 会话（跨命名空间互杀）；无 sid 会话不校验此列，清 cookie 已阻断重放。
    const revokeToken = tokenFromRequest(req);
    if (revokeToken && (await this.authService.shouldRevokeSession(revokeToken))) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { webSessionId: null },
      });
    }

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

  @Get('departments')
  @AnyRole()
  @ApiOperation({ summary: '获取部门列表（下拉选择用，公司隔离）' })
  async listDepartments(@Query('scope') scope: string | undefined, @Req() req: any) {
    // 2026-11-02 公司隔离：只返回本公司部门——此前全量返回专家库导入的 101 条跨公司杂糅（部门+
    // 职务混编），他司组织不该进个人资料下拉；admin 亦按本人公司过滤（全量例外曾致同名跨公司行撞
    // 下拉 key），平台级全量走显式 ?scope=platform（仅 admin）。
    const u = req?.user?.sub
      ? await this.prisma.user.findUnique({ where: { id: req.user.sub }, select: { companyId: true, role: true } })
      : null;
    if (scope === 'platform') {
      if (u?.role !== 'admin') {
        throw new ForbiddenException({ error: '仅管理员可使用平台级视野', code: 'FORBIDDEN' });
      }
      return this.prisma.department.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      });
    }
    if (!u?.companyId) return [];
    return this.prisma.department.findMany({
      where: { companyId: u.companyId },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('departments')
  @AnyRole()
  @ApiOperation({ summary: '按名找/建本公司部门（个人资料手输部门时用，幂等）' })
  async findOrCreateDepartment(@Body() dto: { name: string }, @Req() req: any) {
    const name = dto?.name?.trim();
    if (!name) throw new BadRequestException({ error: '部门名称不能为空', code: 'NAME_REQUIRED' });
    const u = req?.user?.sub
      ? await this.prisma.user.findUnique({ where: { id: req.user.sub }, select: { companyId: true } })
      : null;
    if (!u?.companyId) {
      throw new BadRequestException({ error: '账号未归属公司，无法创建部门，请联系管理员', code: 'NO_COMPANY' });
    }
    const existing = await this.prisma.department.findFirst({
      where: { companyId: u.companyId, name },
      select: { id: true, name: true, code: true },
    });
    if (existing) return existing;
    return this.prisma.department.create({
      data: { name, companyId: u.companyId },
      select: { id: true, name: true, code: true },
    });
  }
}
