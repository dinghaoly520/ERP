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
        signingCaCertificate: { select: { serialHex: true, subjectDisplay: true, notAfter: true } },
        encryptionCaCertificate: { select: { serialHex: true, subjectDisplay: true, notAfter: true } },
      },
    });
    const isCa = activeBinding?.credentialScheme === 'scca-pkcs7';
    return {
      provider: isCa ? 'scca' : 'none',
      credentialScheme: activeBinding?.credentialScheme ?? 'legacy-raw-sm2',
      caCredentialRevision: (supplier as any).caCredentialRevision ?? 0,
      activeBinding: activeBinding ? {
        id: activeBinding.id,
        kind: isCa ? 'ca' : 'legacy',
        signingCert: activeBinding.signingCaCertificate
          ? { serialHex: activeBinding.signingCaCertificate.serialHex, subject: activeBinding.signingCaCertificate.subjectDisplay, notAfter: activeBinding.signingCaCertificate.notAfter }
          : null,
        encryptionCert: activeBinding.encryptionCaCertificate
          ? { serialHex: activeBinding.encryptionCaCertificate.serialHex, subject: activeBinding.encryptionCaCertificate.subjectDisplay, notAfter: activeBinding.encryptionCaCertificate.notAfter }
          : null,
      } : null,
      allowedActions: isCa ? ['self-test', 'sign'] : [],
      allowedEnvelopeVersions: isCa ? ['dual-v2', 'dual-v3'] : ['dual-v2'],
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

    // 资格通过 → 服务端从 capabilities 取当前 ACTIVE 证书指纹（不信任客户端传入）
    const active = await this.prisma.supplierCert.findFirst({
      where: { supplierId: supplier.id, bindingStatus: 'ACTIVE' },
      include: { signingCaCertificate: true },
    });
    const signSha = active?.signingCaCertificate?.sha256Fingerprint ?? '';
    // 新双证指纹由绑定提交时传入——挑战覆盖旧 activeBindingId + caCredentialRevision
    const ch = await this.challengeService.createBound({
      userId, sid: sid ?? '', purpose: active ? 'replace' : 'bind',
      signCertSha256: signSha || 'new-bind',
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

    // 身份核对：签名证 DN 的 SN/OU=NO.1: === Supplier.creditCode
    const dnIdNumber = extractDnIdNumber(signCert.subjectDn);
    if (dnIdNumber && supplier.creditCode && dnIdNumber !== supplier.creditCode) {
      throw new BadRequestException({
        error: `证书主体识别号(${dnIdNumber})与账号统一社会信用代码(${supplier.creditCode})不一致`,
        code: 'CA_IDENTITY_MISMATCH',
      });
    }

    // 消费挑战
    const claimed = await this.challengeService.claimAndConsume(dto.challengeId, 'bind', `${userId}:${sid ?? ''}`);
    if (!claimed) throw new ConflictException({ error: '挑战已消费或已过期', code: 'CA_CHALLENGE_USED' });

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

      // 新行
      const binding = await tx.supplierCert.create({
        data: {
          supplierId: supplier.id,
          certSn: signCert.serialHex.toLowerCase(), // 用 X.509 serial（新 CA 行不占旧 certSn 命名空间）
          certDn: signCert.subjectDn,
          publicKey: signCert.publicKeyHex,
          credentialScheme: 'scca-pkcs7',
          signingCaCertificateId: signCaCert.id,
          encryptionCaCertificateId: encCaCert.id,
          bindingRevision: ((supplier as any).caCredentialRevision ?? 0) + 1,
          createdBy: userId,
          bindingStatus: 'ACTIVE',
        },
      });

      // revision++（raw SQL——pnpm workspace Prisma client 生成缓存未含此列，schema-drift 记忆在册）
      await tx.$executeRawUnsafe('UPDATE "Supplier" SET "caCredentialRevision" = "caCredentialRevision" + 1 WHERE id = $1', supplier.id);

      return binding;
    }, { timeout: 15000 });

    // 证据记录
    await this.evidenceService.record({
      requestId: `bind-${Date.now()}`, purpose: 'bind',
      p7B64: dto.signP7, toSign: claimed.toSign,
      outcome: verification, actorUserId: userId, subjectId: supplier.id, bindingId: result.id,
    });

    return { cert: { id: result.id, credentialScheme: 'scca-pkcs7' }, evidenceId: `evi-${Date.now()}` };
  }

  @Get('operations/:operationId')
  @AnyRole()
  @ApiOperation({ summary: 'CA 操作结果查询（超时恢复）' })
  async getOperation(@Param('operationId') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    const op = await this.operationService.findById(id);
    if (!op) return { status: 'NOT_FOUND' };
    // 主体归属校验（登录操作 subjectId 可能 null——跳过）
    if (op.subjectId && op.subjectId !== userId) {
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
