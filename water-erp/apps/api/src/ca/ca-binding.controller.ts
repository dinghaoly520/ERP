/* =================================================================
   ca-binding.controller — CA 双证绑定/能力投影/操作查询（阶段1 Task8）
   ================================================================= */
import { Controller, Post, Get, Body, Param, Req, HttpCode, HttpStatus, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AnyRole } from '../common/decorators/any-role.decorator';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { v3Enabled } from '../supplier-portal/envelope-version.util';
import { CaChallengeService } from './ca-challenge.service';
import { CaVerificationService, normalizeToDer } from './ca-verification.service';
import { CaEvidenceService } from './ca-evidence.service';
import { CaOperationService } from './ca-operation.service';
import { CaEligibilityService } from './ca-eligibility.service';
import { parseCertificate } from '../common/crypto/x509/x509-cert';
import { loadCaConfig } from './ca.module';
import { IsString, MinLength, MaxLength, IsOptional, IsIn } from 'class-validator';

export class CaBindChallengeDto {
  @IsString() @MinLength(10) @MaxLength(128) credentialProofId!: string;
  @IsString() @MinLength(50) @MaxLength(90000) signCertPem!: string;
  @IsString() @MinLength(50) @MaxLength(90000) encCertPem!: string;
}

export class CaBindDto {
  @IsString() @IsIn(['scca-pkcs7']) credentialScheme!: string;
  @IsString() @MinLength(10) @MaxLength(128) challengeId!: string;
  @IsString() @MinLength(32) @MaxLength(262144) signP7!: string;
  @IsString() @MinLength(10) @MaxLength(128) credentialProofId!: string;
  @IsString() @MinLength(50) @MaxLength(90000) signCertPem!: string;
  @IsString() @MinLength(50) @MaxLength(90000) encCertPem!: string;
  @IsOptional() @IsString() @MaxLength(64) expectedActiveBindingId?: string | null;
}

@ApiTags('CA 绑定')
@Controller('ca')
export class CaBindingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challengeService: CaChallengeService,
    private readonly verificationService: CaVerificationService,
    private readonly evidenceService: CaEvidenceService,
    private readonly operationService: CaOperationService,
    private readonly eligibilityService: CaEligibilityService,
  ) {}

  @Get('capabilities')
  @AnyRole()
  @ApiOperation({ summary: '当前主体 CA 能力投影' })
  async getCapabilities(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    if (!userId) return { provider: 'none', allowedActions: [], allowedEnvelopeVersions: ['dual-v2'] };
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) return { provider: 'none', allowedActions: [], allowedEnvelopeVersions: ['dual-v2'] };

    const activeBinding = await this.prisma.supplierCert.findFirst({
      where: { supplierId: supplier.id, bindingStatus: 'ACTIVE' },
      include: {
        signingCaCertificate: { select: { serialHex: true, subjectDisplay: true, notAfter: true, sha256Fingerprint: true } },
        encryptionCaCertificate: { select: { serialHex: true, subjectDisplay: true, notAfter: true } },
      },
    });
    const isCa = activeBinding?.credentialScheme === 'scca-pkcs7';
    return {
      provider: isCa ? 'scca' : 'none',
      credentialScheme: activeBinding?.credentialScheme ?? 'legacy-raw-sm2',
      caCredentialRevision: supplier.caCredentialRevision,
      activeBinding: activeBinding ? {
        id: activeBinding.id,
        kind: isCa ? 'ca' : 'legacy',
        signingCert: activeBinding.signingCaCertificate
          ? { serialHex: activeBinding.signingCaCertificate.serialHex, subject: activeBinding.signingCaCertificate.subjectDisplay, notAfter: activeBinding.signingCaCertificate.notAfter, sha256Fingerprint: activeBinding.signingCaCertificate.sha256Fingerprint }
          : null,
        encryptionCert: activeBinding.encryptionCaCertificate
          ? { serialHex: activeBinding.encryptionCaCertificate.serialHex, subject: activeBinding.encryptionCaCertificate.subjectDisplay, notAfter: activeBinding.encryptionCaCertificate.notAfter }
          : null,
      } : null,
      allowedActions: isCa ? ['self-test', 'sign'] : [],
      // Task13：v3 灰度开关——未开启时前端只组装 dual-v2（服务端投递链 v3 仍可用，仅前端投影收窄）
      allowedEnvelopeVersions: isCa && v3Enabled() ? ['dual-v2', 'dual-v3'] : ['dual-v2'],
      disabledReasons: isCa ? [] : ['未绑定 SCCA CA 证书'],
    };
  }

  @Post('bind-challenge')
  @Roles('supplier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '绑定挑战（已登录+近期凭据验证后调用）' })
  async createBindChallenge(@Body() dto: CaBindChallengeDto, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    const sid = (req as any).user?.sid;
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) throw new ForbiddenException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });

    await this.eligibilityService.assertBindEligible(supplier.id, userId);

    // C1 修复：原子消费近期密码重证凭据（userId+action 校验）——失败即拒
    const proofOk = await this.challengeService.consumeProof(dto.credentialProofId, userId, 'bind');
    if (!proofOk) {
      throw new ForbiddenException({ error: '密码验证已失效，请重新验证', code: 'REAUTH_REQUIRED' });
    }

    // I11 修复：待绑双证指纹（签名+加密）都入签名上下文——签名承诺覆盖双证集合
    const signDer = normalizeToDer(dto.signCertPem);
    const encDer = normalizeToDer(dto.encCertPem);
    const signSha = createHash('sha256').update(signDer).digest('hex');
    const encSha = createHash('sha256').update(encDer).digest('hex');

    const active = await this.prisma.supplierCert.findFirst({
      where: { supplierId: supplier.id, bindingStatus: 'ACTIVE' },
    });
    const ch = await this.challengeService.createBound({
      userId, sid: sid ?? '', purpose: active ? 'replace' : 'bind',
      signCertSha256: signSha, encCertSha256: encSha,
    });
    return {
      challengeId: ch.challengeId,
      operationId: ch.challengeId, // 简化——阶段2 分离
      toSign: ch.toSign,
      expiresAt: ch.expiresAt.toISOString(),
      purpose: active ? 'replace' : 'bind',
      expectedActiveBindingId: active?.id ?? null,
    };
  }

  @Post('bind')
  @Roles('supplier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  @ApiOperation({ summary: 'CA 双证绑定/换绑' })
  async bind(@Body() dto: CaBindDto, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    const sid = (req as any).user?.sid;
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) throw new ForbiddenException({ error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });

    // 资格+在途门禁
    await this.eligibilityService.assertBindEligible(supplier.id, userId);

    // 解析双证
    const signDer = normalizeToDer(dto.signCertPem);
    const encDer = normalizeToDer(dto.encCertPem);
    const signCert = parseCertificate(signDer);
    const encCert = parseCertificate(encDer);
    const signSha = createHash('sha256').update(signDer).digest('hex');
    const encSha = createHash('sha256').update(encDer).digest('hex');

    // KeyUsage 硬校验（签名证=DigitalSignature；加密证=KeyEncipherment）
    if (!signCert.keyUsage.includes('DigitalSignature')) {
      throw new BadRequestException({ error: '签名证书 KeyUsage 缺 DigitalSignature', code: 'CA_ALG_UNSUPPORTED' });
    }
    if (!encCert.keyUsage.includes('KeyEncipherment')) {
      throw new BadRequestException({ error: '加密证书 KeyUsage 缺 KeyEncipherment', code: 'CA_ALG_UNSUPPORTED' });
    }

    // I10 修复：身份核对 fail-closed——企业账号绑定证书必须携带 18 位识别号且与 creditCode 一致；
    // DN 无识别号不再放行（个人证书/无号证书不得绑定企业供应商账号）
    const dnIdNumber = extractDnIdNumber(signCert.subjectDn);
    if (!dnIdNumber || (supplier.creditCode && dnIdNumber !== supplier.creditCode)) {
      throw new BadRequestException({
        error: dnIdNumber
          ? `证书主体识别号(${dnIdNumber})与账号统一社会信用代码(${supplier.creditCode})不一致`
          : '证书主体缺少机构识别号（SN/OU=NO.1），无法绑定企业账号',
        code: 'CA_IDENTITY_MISMATCH',
      });
    }

    // 消费挑战——purpose 用创建时的实际值（首绑 bind/换绑 replace 同族，硬编码会 MISMATCH）
    const actualPurpose = (await this.challengeService.getPurpose(dto.challengeId)) ?? 'bind';
    const claimed = await this.challengeService.claimAndConsume(
      dto.challengeId, actualPurpose as 'bind' | 'replace', `${userId}:${sid ?? ''}`);
    if (!claimed) throw new ConflictException({ error: '挑战已消费或已过期', code: 'CA_CHALLENGE_USED' });

    // I11 第二半：已签上下文承诺的加密证指纹必须与本次提交一致（双证集合不可替换）
    try {
      const ctx: { encCertSha256?: string } = JSON.parse(claimed.toSign);
      if (ctx.encCertSha256 && ctx.encCertSha256 !== encSha) {
        throw new BadRequestException({ error: '加密证书与签名上下文不符', code: 'CA_CERT_MISMATCH' });
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException({ error: '绑定上下文异常', code: 'CA_CHALLENGE_INVALID' });
    }

    // 验签
    const verification = await this.verificationService.verifySignature({
      p7B64: dto.signP7, expectedToSign: claimed.toSign, purpose: 'bind',
      expectedSignCert: { serialHex: signCert.serialHex.toLowerCase(), sha256: signSha },
    });
    if (!verification.ok) {
      throw new BadRequestException({ error: `签名验证失败: ${verification.code}`, code: verification.code });
    }

    // 事务：CaCertificate upsert + Claim + SupplierCert 新行 + 旧 ACTIVE→REVOKED + revision++
    const result = await this.prisma.$transaction(async (tx) => {
      // 双证 upsert
      const signCaCert = await tx.caCertificate.upsert({
        where: { sha256Fingerprint: signSha },
        create: {
          derBase64: signDer.toString('base64'), sha256Fingerprint: signSha,
          serialHex: signCert.serialHex.toLowerCase(),
          issuerNameDerHash: createHash('sha256').update(signCert.issuerDn).digest('hex'),
          issuerDisplay: signCert.issuerDn, subjectDisplay: signCert.subjectDn,
          spkiAlgorithmOid: signCert.spkiAlgOid, curveOid: signCert.curveOid,
          keyUsage: signCert.keyUsage, extendedKeyUsage: signCert.extendedKeyUsage,
          unknownExtensionOids: signCert.unknownExtensionOids,
          notBefore: signCert.notBefore, notAfter: signCert.notAfter,
        },
        update: {},
      });
      const encCaCert = await tx.caCertificate.upsert({
        where: { sha256Fingerprint: encSha },
        create: {
          derBase64: encDer.toString('base64'), sha256Fingerprint: encSha,
          serialHex: encCert.serialHex.toLowerCase(),
          issuerNameDerHash: createHash('sha256').update(encCert.issuerDn).digest('hex'),
          issuerDisplay: encCert.issuerDn, subjectDisplay: encCert.subjectDn,
          spkiAlgorithmOid: encCert.spkiAlgOid, curveOid: encCert.curveOid,
          keyUsage: encCert.keyUsage, extendedKeyUsage: encCert.extendedKeyUsage,
          unknownExtensionOids: encCert.unknownExtensionOids,
          notBefore: encCert.notBefore, notAfter: encCert.notAfter,
        },
        update: {},
      });

      // Claim（全局占用）
      try {
        await tx.caSigningCertificateClaim.create({
          data: { certificateId: signCaCert.id, supplierId: supplier.id },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new ConflictException({ error: '该签名证书已被其他主体占用', code: 'CA_CERT_ALREADY_CLAIMED' });
        }
        throw e;
      }

      // 旧 ACTIVE → REVOKED
      await tx.supplierCert.updateMany({
        where: { supplierId: supplier.id, bindingStatus: 'ACTIVE' },
        data: { bindingStatus: 'REVOKED', revokedAt: new Date() },
      });

      // C2 修复：CAS 复核——当前 ACTIVE 绑定必须与客户端预期一致（首绑均 null，换绑传旧 id）
      const currentActive = await tx.supplierCert.findFirst({
        where: { supplierId: supplier.id, bindingStatus: 'ACTIVE' },
        select: { id: true },
      });
      if ((currentActive?.id ?? null) !== (dto.expectedActiveBindingId ?? null)) {
        throw new ConflictException({ error: '绑定状态已变化，请刷新后重试', code: 'CA_BINDING_CHANGED' });
      }

      // 新行——I7 修复：certSn 用按行唯一命名空间（legacy 序列号命名空间留给 legacy 行；
      // CA 行经 signingCaCertificateId 定位；合同 E.77 的可空化随阶段 2 读端收窄后落地）
      const binding = await tx.supplierCert.create({
        data: {
          supplierId: supplier.id,
          certSn: 'ca-' + require('crypto').randomUUID(),
          certDn: signCert.subjectDn,
          publicKey: signCert.publicKeyHex,
          credentialScheme: 'scca-pkcs7',
          signingCaCertificateId: signCaCert.id,
          encryptionCaCertificateId: encCaCert.id,
          bindingRevision: (supplier.caCredentialRevision) + 1,
          createdBy: userId,
          bindingStatus: 'ACTIVE',
        },
      });

      await tx.supplier.update({
        where: { id: supplier.id },
        data: { caCredentialRevision: { increment: 1 } },
      });

      return binding;
    }, { timeout: 15000 });

    // 证据记录——失败不阻断已成功的绑定响应（绑定已落库，证据可补）
    try {
      await this.evidenceService.record({
        requestId: `bind-${Date.now()}`, purpose: actualPurpose,
        p7B64: dto.signP7, toSign: claimed.toSign,
        outcome: verification, actorUserId: userId, subjectId: supplier.id, bindingId: result.id,
      });
    } catch (e) {
      console.error('[CA] 绑定证据记录失败（绑定已成功）:', (e as Error).message);
    }

    return { cert: { id: result.id, credentialScheme: 'scca-pkcs7' }, evidenceId: `evi-${Date.now()}` };
  }

  @Get('operations/:operationId')
  @AnyRole()
  @ApiOperation({ summary: 'CA 操作结果查询（超时恢复）' })
  async getOperation(@Param('operationId') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    const op = await this.operationService.findById(id);
    if (!op) return { status: 'NOT_FOUND' };
    // 主体归属校验（登录操作 subjectId 可能 null——跳过）。
    // 阶段2.5 T8 修复：投递链 op 的 subjectId=supplier.id（供应商域）——对 supplier
    // 主体按 supplier.findUnique(userId).id 比对（原 User id 直比恒 403）
    let subjectId = op.subjectId;
    if (subjectId && op.subjectType === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({ where: { userId }, select: { id: true } });
      if (supplier && subjectId !== supplier.id) {
        throw new ForbiddenException({ error: '无权访问', code: 'FORBIDDEN' });
      }
      if (!supplier && subjectId !== userId) {
        throw new ForbiddenException({ error: '无权访问', code: 'FORBIDDEN' });
      }
    } else if (subjectId && subjectId !== userId) {
      throw new ForbiddenException({ error: '无权访问', code: 'FORBIDDEN' });
    }
    return { status: op.status, result: op.result, evidenceId: null };
  }
}

// ─── 内部工具 ───
function extractDnIdNumber(subjectDn: string): string | null {
  // SN=500999202610091118 或 OU=NO.1:500999202610091118
  const snMatch = /SN=([0-9A-Z]{18})/i.exec(subjectDn);
  if (snMatch) return snMatch[1]!;
  const ouMatch = /OU=NO\.1:([0-9A-Z]{18})/i.exec(subjectDn);
  if (ouMatch) return ouMatch[1]!;
  return null;
}
