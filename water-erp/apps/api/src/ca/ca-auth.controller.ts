/* =================================================================
   ca-auth.controller — /auth/ca/* 认证端点（阶段1 Task7）

   五端点：
   GET  /auth/ca/config    @Public  公开配置（enabled/portalSupport）
   POST /auth/ca/challenge @Public  创建登录挑战（匿名 cookie 绑定）
   POST /auth/ca/login     @Public  P7 验签 + 共享登录收尾
   POST /auth/ca/result    @Public  响应丢失恢复（凭匿名 cookie+sessionMeta）
   POST /auth/ca/reauth    @Roles   近期密码重证（绑定/换绑/解绑前置）

   设计依据：附录 §4.2 B 契约 + 计划 Task7。
   ================================================================= */
import { Controller, Get, Post, Body, Req, Res, HttpCode, HttpStatus, UnauthorizedException, ConflictException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CaChallengeService } from './ca-challenge.service';
import { CaVerificationService, normalizeToDer } from './ca-verification.service';
import { CaEvidenceService } from './ca-evidence.service';
import { CaOperationService } from './ca-operation.service';
import { parseCertificate } from '../common/crypto/x509/x509-cert';
import { compareSync } from 'bcryptjs';
import { buildSessionMeta } from '../common/session-device.util';
import { getClientIp } from '../common/client-ip.util';
import { cookieNameForPortal } from '../auth/portal-cookie';
import { loadCaConfig } from './ca.module';

// ─── DTO（class-validator 严格校验）───
import { IsString, IsIn, MaxLength, IsOptional, MinLength } from 'class-validator';

export class CaChallengeDto {
  @IsString() @IsIn(['scca']) provider!: string;
  @IsString() @MinLength(50) @MaxLength(90000) signCertPem!: string;
}

export class CaLoginDto {
  @IsString() @MinLength(10) @MaxLength(128) challengeId!: string;
  @IsString() @MinLength(32) @MaxLength(262144) signP7!: string; // 256KiB 严格 Base64
}

export class CaResultDto {
  @IsString() @MinLength(10) @MaxLength(128) challengeId!: string;
}

export class CaReauthDto {
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @IsString() @IsIn(['bind', 'replace', 'revoke']) action!: string;
  @IsOptional() @IsString() @MaxLength(64) targetBindingId?: string;
  @IsOptional() @IsString() @MaxLength(64) expectedActiveBindingId?: string;
  @IsOptional() @IsString() @MaxLength(90000) signCertPem?: string;
  @IsOptional() @IsString() @MaxLength(90000) encCertPem?: string;
}

// ─── 匿名 cookie 工具 ───
const CA_COOKIE_PREFIX = 'ca_browser_';
function caCookieName(portal: string): string { return `${CA_COOKIE_PREFIX}${portal}`; }
function caCookieHash(cookieValue: string): string {
  return createHash('sha256').update(cookieValue).digest('hex');
}
const CA_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth/ca/',
  maxAge: 10 * 60 * 1000, // 10 分钟
};

@ApiTags('CA 认证')
@Controller('auth/ca')
export class CaAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly challengeService: CaChallengeService,
    private readonly verificationService: CaVerificationService,
    private readonly evidenceService: CaEvidenceService,
    private readonly operationService: CaOperationService,
  ) {}

  @Get('config')
  @Public()
  @ApiOperation({ summary: 'CA 登录配置（公开）' })
  getConfig() {
    const cfg = loadCaConfig();
    return {
      enabled: cfg.CA_LOGIN_ENABLED,
      portalSupport: { supplier: true, expert: false }, // 阶段1 仅供应商
      clientNote: '请插入四川CA U盾并启动证书助手',
    };
  }

  @Post('challenge')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'CA 登录挑战（匿名）' })
  async createChallenge(
    @Body() dto: CaChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 解析证书提取指纹
    const der = normalizeToDer(dto.signCertPem);
    const cert = parseCertificate(der);
    const certSha = createHash('sha256').update(der).digest('hex');

    // 匿名 cookie：已有则复用，没有则签发
    const portal = 'supplier'; // 阶段1 仅供应商
    let cookieValue = (req.cookies as Record<string, string>)?.[caCookieName(portal)];
    if (!cookieValue) {
      cookieValue = randomBytes(32).toString('hex');
      res.cookie(caCookieName(portal), cookieValue, CA_COOKIE_OPTS);
    }
    const bh = caCookieHash(cookieValue);

    const ch = await this.challengeService.createLogin({
      portal, browserCookieHash: bh, signCertSha256: certSha,
    });

    return {
      challengeId: ch.challengeId,
      toSign: ch.toSign,
      encoding: 'UTF-8',
      signatureFormat: 'scca-pkcs7-base64',
      expiresAt: ch.expiresAt.toISOString(),
    };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'CA 登录（P7 验签 + 共享登录收尾）' })
  async login(
    @Body() dto: CaLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const portal = 'supplier';
    const cookieValue = (req.cookies as Record<string, string>)?.[caCookieName(portal)];
    if (!cookieValue) throw new UnauthorizedException({ error: '会话已过期，请重新发起', code: 'CA_CHALLENGE_EXPIRED' });
    const bh = caCookieHash(cookieValue);

    // 原子消费挑战
    const claimed = await this.challengeService.claimAndConsume(dto.challengeId, 'ca-login', `${portal}:${bh}`);
    if (!claimed) throw new ConflictException({ error: '挑战已消费或已过期', code: 'CA_CHALLENGE_USED' });

    // 从挑战 payload 中取证书指纹
    const certSha = extractFingerprintFromToSign(claimed.toSign);
    if (!certSha) throw new UnauthorizedException({ error: '挑战数据异常', code: 'CA_CHALLENGE_INVALID' });

    // 验签（World B：本地比对 + 三方指纹 + 网关）
    const verification = await this.verificationService.verifySignature({
      p7B64: dto.signP7,
      expectedToSign: claimed.toSign,
      purpose: 'ca-login',
      expectedSignCert: { serialHex: '', sha256: certSha }, // serialHex 由验证服务从 P7 提取后比对
    });
    if (!verification.ok) {
      throw new UnauthorizedException({ error: verificationErrorMessage(verification.code), code: verification.code });
    }

    // 从证书指纹查绑定的用户
    const cert = await this.prisma.caCertificate.findUnique({ where: { sha256Fingerprint: certSha } });
    if (!cert) throw new UnauthorizedException({ error: '证书未绑定', code: 'CA_CERT_NOT_BOUND' });
    const binding = await this.prisma.supplierCert.findFirst({
      where: { signingCaCertificateId: cert.id, bindingStatus: 'ACTIVE' },
      include: { supplier: { include: { user: true } } },
    });
    if (!binding?.supplier?.user) throw new UnauthorizedException({ error: '证书未绑定', code: 'CA_CERT_NOT_BOUND' });

    const user = binding.supplier.user;

    // 账号状态检查（在验签通过后才给具体提示）
    if (!user.isActive) throw new UnauthorizedException({ error: '账号待审核，尚未激活', code: 'ACCOUNT_PENDING' });
    if (user.isFrozen) throw new UnauthorizedException({ error: '该账号已被冻结，请联系管理员', code: 'ACCOUNT_FROZEN' });

    const supplier = binding.supplier;
    if (supplier.status !== 'APPROVED') {
      throw new UnauthorizedException({ error: '供应商账号未审核通过', code: 'ACCOUNT_PENDING' });
    }

    // 共享登录收尾：会话轮换 + cookie 写入 + 审计（复用 AuthService）
    const device = buildSessionMeta((req.headers['user-agent'] as string) ?? null, getClientIp(req));
    const result = await this.authService.rotatePortalSession(user.id, user.username, user.role, device);

    // 写 cookie + 清匿名 cookie
    const cookiePortal = portalForRole(user.role) || 'supplier';
    res.cookie(cookieNameForPortal(cookiePortal), result.access_token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    });
    res.clearCookie(caCookieName(portal), CA_COOKIE_OPTS);

    // 审计
    await this.prisma.auditLog.create({
      data: {
        userId: user.id, action: 'CA_LOGIN', resourceType: 'auth', resourceId: user.id,
        details: { role: user.role, certSn: cert.serialHex }, ipAddress: getClientIp(req),
        userAgent: (req.headers['user-agent'] as string) ?? null,
      },
    });

    return { access_token: result.access_token, role: user.role, username: user.username };
  }

  @Post('result')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'CA 登录响应丢失恢复' })
  async recoverResult(
    @Body() dto: CaResultDto,
    @Req() req: Request,
  ) {
    const portal = 'supplier';
    const cookieValue = (req.cookies as Record<string, string>)?.[caCookieName(portal)];
    if (!cookieValue) return { status: 'unconfirmed' };
    // TODO：sessionMeta.caLoginChallengeId 匹配——阶段1 试点先用简化实现
    return { status: 'unconfirmed', message: '请重新发起 CA 登录' };
  }

  @Post('reauth')
  @Roles('supplier', 'bid_expert')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5/5min
  @ApiOperation({ summary: '近期密码重证（绑定/换绑/解绑前置）' })
  async reauth(@Body() dto: CaReauthDto, @Req() req: Request) {
    // 密码验证复用 AuthService（不走完整 login——不轮换会话）
    const user = await this.prisma.user.findUnique({ where: { id: (req as any).user?.sub } });
    if (!user) throw new UnauthorizedException();
    const valid = user.passwordHash ? compareSync(dto.password, user.passwordHash) : false;
    if (!valid) throw new UnauthorizedException({ error: '密码错误', code: 'REAUTH_FAILED' });

    // 签发一次性凭据证明（C1 修复：落 Redis 300s TTL——bind-challenge 消费时原子校验）
    const proofId = `ca-proof-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const sid = (req as any).user?.sid ?? '';
    await this.challengeService.storeProof({ proofId, userId: user.id, sid, action: dto.action });
    const operationDigest = createHash('sha256')
      .update(JSON.stringify({ action: dto.action, target: dto.targetBindingId, ts: Date.now() }))
      .digest('hex');
    return { credentialProofId: proofId, operationDigest, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
}

// ─── 内部工具 ───
function extractFingerprintFromToSign(toSign: string): string | null {
  try {
    const json = JSON.parse(toSign.replace(/^LOGONDATA:/, ''));
    return json.signFingerprint ?? null;
  } catch { return null; }
}

function verificationErrorMessage(code?: string): string {
  const map: Record<string, string> = {
    CA_CONTENT_MISMATCH: '签名原文不匹配',
    CA_P7_MALFORMED: '签名数据格式错误',
    CA_FINGERPRINT_MISMATCH: '证书指纹不一致',
    CA_ALG_UNSUPPORTED: '证书算法不支持',
    CA_CERT_EXPIRED: '证书已过期',
    CA_CERT_CHAIN: '证书链验证失败',
    CA_GATEWAY_REJECTED: '验签服务拒绝',
    CA_VERIFY_UNAVAILABLE: '验签服务暂时不可用，请稍后重试',
    CA_SIGNER_COUNT: '签名者异常',
  };
  return map[code ?? ''] ?? '签名验证失败';
}

function portalForRole(role: string): string {
  const map: Record<string, string> = {
    supplier: 'supplier', bid_expert: 'expert', admin: 'bid', bid_host: 'bid', leader: 'web', staff: 'web', mall: 'mall',
  };
  return map[role] ?? 'public';
}
