import { Injectable, BadRequestException, ForbiddenException, ConflictException, NotFoundException, Optional, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { BidService } from '../bid/bid.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { ConvertToRegularDto } from './dto/convert-to-regular.dto';
import { buildClarificationReplyCanonical } from './clarification-reply.util';
import { buildOpeningConfirmCanonical } from './opening-confirm-signature.util';
import { ClarificationReplyDraftDto, SubmitClarificationReplyDto } from './dto/clarification-reply.dto';
import { isSupplierChangeAllowedField } from '../supplier/supplier-change-fields';
import { encryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';
import { wrapKey } from '../common/crypto/envelope-crypto';
import { sealField, openField } from '../common/crypto/field-crypto';
import { SignatureService } from '../common/crypto/signature.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { canonicalEnvelopeHash, sha256Hex } from '@water-erp/ukey';
import type { DualEnvelope, EnvelopeRole, SealedFields } from '@water-erp/ukey';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { BidBackupService, BackupFileRole, StagedBackup } from '../bid-backup/bid-backup.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';
import { isPeriodMismatch, isPriceMismatch, resolveExpectedInYuan, resolveDisplayInYuan } from '../bid/opening-compare.util';
import { assertDecryptCheckInQuorum } from '../bid/decrypt-quorum.util';
import { LlmService } from '../local-ai/llm.service';
import * as crypto from 'crypto';

/** 供应商投标提交/草稿共用的可持久化字段 */
type BidSubmissionData = {
  bidPrice?: string;
  deliveryPeriod?: string;
  qualityCommitment?: string;
  technicalFile?: string;
  businessFile?: string;
  coverLetter?: string;
  technicalFileAssetId?: string;
  businessFileAssetId?: string;
  coverLetterAssetId?: string;
  bidBondAssetId?: string;
  fileHash?: string;
  signature?: string;
  // P0-1：前端完整/拆分模型字段（BidSubmit.vue）。由 normalizeBidFileAssets 归一到三角色契约。
  fullBidFileAssetId?: string;
  coverLetterFileAssetId?: string;
  splitFiles?: { tech?: any; biz?: any; other?: any };
  // E2EE: 客户端加密密钥（assetId → "keyHex:ivHex:authTagHex"）
  clientDeks?: Record<string, string>;
  // 双信封 v2（dual-v2 新轨）：客户端密封信封（version/certSn/adminCertId/files/sealedFields/fieldsCommit）
  envelope?: DualEnvelope;
  // P1-1：旧轨代解密授权（办法第30条留痕）——旧轨提交必勾；新轨供应商自解忽略
  hostDecryptAuthorized?: boolean;
};

/**
 * 仅保留供应商可提交的合法字段，杜绝 Mass Assignment。
 * 原先 controller 用内联类型透传 body（无 class-validator DTO，ValidationPipe whitelist 不生效），
 * `...data` 直接铺进 Prisma data，可被注入 supplierId（冒名投递）/ status:'submitted'（绕过加密+验签+阶段门控）/
 * submittedAt / signedAt 等。此处显式枚举白名单，剥离一切越权字段。
 */
function pickBidSubmissionFields(data: BidSubmissionData) {
  return {
    // bidPrice 入库即密封（防采购管理人员在开标解密前从 DB/工作台读到封存报价）。
    // deliveryPeriod 不加密，但下游暴露点统一按 decryptStatus==='SUCCESS' 门控。
    bidPrice: data.bidPrice ? sealField(data.bidPrice, process.env.KMS_SECRET!) : null,
    deliveryPeriod: data.deliveryPeriod,
    qualityCommitment: data.qualityCommitment,
    technicalFile: data.technicalFile,
    businessFile: data.businessFile,
    coverLetter: data.coverLetter,
    technicalFileAssetId: data.technicalFileAssetId,
    businessFileAssetId: data.businessFileAssetId,
    coverLetterAssetId: data.coverLetterAssetId,
    bidBondAssetId: data.bidBondAssetId,
    fileHash: data.fileHash,
    signature: data.signature,
    hostDecryptAuthorized: data.hostDecryptAuthorized ?? false,
    // 双信封 v2（Task 9）：信封原样落库（Json 列）；旧轨恒 undefined → 列不动。
    // DualEnvelope 接口无隐式索引签名，入 Prisma Json 列需经 unknown 收口。
    envelope: (data.envelope ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
    envelopeVersion: data.envelope?.version ?? undefined,
  };
}

/**
 * dual-v2 逐角色参检表（Task 9 新轨）：三份标书文件 + 投标保证金（bond 仅项目 bondRequired 时参检）。
 * 角色未投递（无 assetId）→ 无锚点可校，跳过；信封独有角色不在服务端校验范围（单向 declared→envelope）。
 */
const DUAL_ROLE_FIELDS: ReadonlyArray<readonly [EnvelopeRole, keyof BidSubmissionData]> = [
  ['technical', 'technicalFileAssetId'],
  ['business', 'businessFileAssetId'],
  ['coverLetter', 'coverLetterAssetId'],
  ['bond', 'bidBondAssetId'],
];

/** dual-v2 角色 → submission 资产列（decrypt-upload 明文存证锚点反查，口径同 DUAL_ROLE_FIELDS） */
const DUAL_ROLE_ASSET_KEY = Object.fromEntries(DUAL_ROLE_FIELDS) as Record<EnvelopeRole, keyof BidSubmissionData>;

/**
 * P0-1：把前端「完整标书 / 拆分文件」模型归一到后端三角色（technical/business/coverLetter）契约。
 * BidSubmit.vue 发 fullBidFileAssetId（完整模式）或 splitFiles{tech,biz,other:FileEntry[]}（拆分模式）+ coverLetterFileAssetId（投标函）。
 * 后端加密/备份/开标/AI 分析管道仅认 technical/business/coverLetter——此处翻译，管道与 schema 不动。
 * 拆分模式每类取首个文件对齐后端单槽（多文件支持需 schema 扩展为数组/关联表，当前优先杜绝整盘丢失）。
 */
function normalizeBidFileAssets(data: BidSubmissionData) {
  let technicalFileAssetId = data.technicalFileAssetId;
  let businessFileAssetId = data.businessFileAssetId;
  let coverLetterAssetId = data.coverLetterAssetId;
  if (data.coverLetterFileAssetId) coverLetterAssetId = data.coverLetterFileAssetId;
  if (data.fullBidFileAssetId) technicalFileAssetId = data.fullBidFileAssetId; // 完整标书=整本，归 technical
  const split: any = data.splitFiles;
  if (split) {
    const firstId = (v: any): string | undefined => Array.isArray(v) ? (v[0]?.id ?? v[0]) : v?.id;
    if (firstId(split.tech)) technicalFileAssetId = firstId(split.tech);
    if (firstId(split.biz)) businessFileAssetId = firstId(split.biz);
    if (firstId(split.other) && !coverLetterAssetId) coverLetterAssetId = firstId(split.other);
  }
  data.technicalFileAssetId = technicalFileAssetId;
  data.businessFileAssetId = businessFileAssetId;
  data.coverLetterAssetId = coverLetterAssetId;
}

/**
 * 企业名/CN 归一化（与 expert-conflict 同口径）：去空白与全/半角括号、间隔符·，去公司形态后缀。
 * 用于 CA 证书 DN 的 CN 段与注册企业名的包含比对（「四川水发建设（集团）有限责任公司」≡「四川水发建设」）。
 */
function normalizeCn(s: string): string {
  return (s || '')
    .replace(/[\s（）()·]/g, '')
    .replace(/(有限责任公司|股份有限公司|有限公司|集团)/g, '');
}

/** 提取证书 DN 的 CN 段（到下一个逗号前，属性名大小写不敏感）；无 CN 段返回 null。 */
function extractDnCn(dn: string): string | null {
  const m = /(?:^|,)\s*cn\s*=\s*([^,]*)/i.exec(dn || '');
  return m ? m[1].trim() : null;
}

@Injectable()
export class SupplierPortalService {
  constructor(
    private prisma: PrismaService,
    private bidDocumentService: BidDocumentService,
    private signatureService: SignatureService,
    private bidBackup: BidBackupService,
    private readonly dualEnvelope: DualEnvelopeService,
    @Inject('REDIS_CLIENT') private redis: Redis,
    private llm: LlmService,
    private notificationService: NotificationService,
    private readonly bidService: BidService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  private readonly logger = new Logger(SupplierPortalService.name);

  /* ── W11-①（CTS A-101）：投标回执 SM2 签名（防抵赖）── */

  /** 规范化回执负载（稳定键序，客户端签名与服务端验签共用同一串）。 */
  private canonicalReceiptPayload(payload: Record<string, unknown>): string {
    const keys = Object.keys(payload).sort();
    return JSON.stringify(keys.reduce((acc, k) => { acc[k] = payload[k]; return acc; }, {} as Record<string, unknown>));
  }

  /** 取回执待签负载（供应商本人；负载以 DB 为准重建，不信任客户端传入）。 */
  async getReceiptPayloadFor(submissionId: string, supplierId: string) {
    const sub = await this.prisma.supplierBidSubmission.findUnique({ where: { id: submissionId } });
    if (!sub || sub.supplierId !== supplierId) {
      throw new ForbiddenException({ error: '回执归属校验失败', code: 'NOT_YOUR_SUBMISSION' });
    }
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { sm2PublicKey: true } });
    if (!supplier?.sm2PublicKey) {
      throw new BadRequestException({ error: '供应商未绑定 SM2 公钥（U盾证书），无法签署回执', code: 'SM2_PUBLIC_KEY_MISSING' });
    }
    const envelope = sub.envelope as { fieldsCommit?: string } | null;
    const payload = {
      v: 1,
      submissionId: sub.id,
      projectId: sub.projectId,
      supplierId: sub.supplierId,
      filesCommit: envelope?.fieldsCommit ?? sub.fileHash ?? null,
      receivedAt: sub.createdAt.toISOString(),
    };
    return { payload, canonical: this.canonicalReceiptPayload(payload) };
  }

  /** 提交回执签名：服务端重建负载 → SM2/SM3 验签 → 存档（幂等）。 */
  async signSubmissionReceipt(submissionId: string, supplierId: string, signature: string) {
    const sub = await this.prisma.supplierBidSubmission.findUnique({ where: { id: submissionId } });
    if (!sub || sub.supplierId !== supplierId) {
      throw new ForbiddenException({ error: '回执归属校验失败', code: 'NOT_YOUR_SUBMISSION' });
    }
    if (sub.receiptSignature) return sub; // 幂等：已签署直接返回
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { sm2PublicKey: true } });
    if (!supplier?.sm2PublicKey) {
      throw new BadRequestException({ error: '供应商未绑定 SM2 公钥（U盾证书），无法签署回执', code: 'SM2_PUBLIC_KEY_MISSING' });
    }
    const { payload, canonical } = await this.getReceiptPayloadFor(submissionId, supplierId);
    const valid = this.signatureService.verify(canonical, signature, supplier.sm2PublicKey);
    if (!valid) {
      throw new BadRequestException({ error: '回执签名验证失败（SM2）', code: 'RECEIPT_SIGNATURE_INVALID' });
    }
    return this.prisma.supplierBidSubmission.update({
      where: { id: submissionId },
      data: {
        receiptSignature: { payload, signature, algorithm: 'SM2/SM3', verifiedAt: new Date().toISOString() },
        receiptSignedAt: new Date(),
      },
    });
  }

  /**
   * 校验投标文件归属：引用的 FileAsset 必须存在、由当前用户上传、且分类为 bid_document。
   * 防止供应商盗用他人/其他分类文件作为投标文件。
   */
  private async assertBidFileAssetsOwnedByUser(userId: string, assetIds: (string | undefined | null)[]) {
    const ids = Array.from(new Set(assetIds.filter((id): id is string => !!id)));
    if (ids.length === 0) return;
    const assets = await this.prisma.fileAsset.findMany({ where: { id: { in: ids } } });
    if (assets.length !== ids.length) {
      throw new BadRequestException({ error: '投标文件不存在', code: 'FILE_NOT_FOUND' });
    }
    const invalid = assets.find(a => a.uploaderId !== userId || a.category !== 'bid_document');
    if (invalid) {
      throw new BadRequestException({
        error: '投标文件无权使用或分类错误',
        code: invalid.uploaderId !== userId ? 'FILE_NOT_OWNED' : 'INVALID_BID_FILE',
      });
    }
  }

  // ─── Profile ───

  async getMyProfile(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, username: true, displayName: true, email: true, isActive: true } },
        classification: true,
        contacts: { orderBy: { isPrimary: 'desc' } },
        qualifications: { orderBy: { createdAt: 'desc' } },
        bankAccounts: { orderBy: { createdAt: 'asc' } },
        performances: { orderBy: { createdAt: 'desc' } },
        _count: { select: { evaluations: true, changeRecords: true } },
      },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'NOT_FOUND' });
    return supplier;
  }

  async getMyStatus(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: {
        id: true, name: true, status: true,
        returnReason: true, rejectReason: true,
        createdAt: true, updatedAt: true,
        isTemporary: true, temporaryExpiresAt: true,
      },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'NOT_FOUND' });
    return supplier;
  }

  // ─── CA 证书绑定（双信封 v2：DN↔企业名校验 + 回填 sm2PublicKey）───

  /**
   * 绑定供应商 CA 证书（U盾枚举后由前端 POST 证书信息）。
   * 校验链：公钥格式（04+128hex）→ DN 的 CN 归一化后须包含注册企业名归一化串 → certSn 全局占用。
   * 成功事务：本供应商旧 ACTIVE 证书转 REVOKED（一证一 ACTIVE，换证/挂失语义）→ 建/复用证书行 →
   * 回填 Supplier.sm2PublicKey（存量列，激活 SM2 验签）。
   */
  async bindCert(supplierId: string, input: { certSn: string; certDn: string; publicKey: string; alg?: string }) {
    const { certSn, certDn, publicKey, alg } = input;
    if (!certSn || !certDn || !publicKey) {
      throw new BadRequestException({ error: '请填写完整证书信息', code: 'MISSING_FIELDS' });
    }
    // 公钥格式校验：复用注入的 SignatureService.isValidPublicKey（与验签同一口径，杜绝正则复制漂移）
    if (!this.signatureService.isValidPublicKey(publicKey)) {
      throw new BadRequestException({ error: 'SM2 公钥格式无效（须为 04 开头的 130 位十六进制）', code: 'INVALID_PUBLIC_KEY' });
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'NOT_FOUND' });

    const cn = extractDnCn(certDn);
    if (!cn || !normalizeCn(cn).includes(normalizeCn(supplier.name))) {
      throw new BadRequestException({ error: '证书主体(CN)与注册企业名称不一致', code: 'DN_MISMATCH' });
    }

    const existing = await this.prisma.supplierCert.findUnique({ where: { certSn } });
    if (existing && (existing.bindingStatus === 'ACTIVE' || existing.supplierId !== supplierId)) {
      throw new ConflictException({ error: '该证书序列号已被绑定', code: 'CERT_SN_EXISTS' });
    }

    const now = new Date();
    try {
      const cert = await this.prisma.$transaction(async (tx) => {
        // 一证一 ACTIVE：旧 ACTIVE 证书先 REVOKED（同一供应商）
        await tx.supplierCert.updateMany({
          where: { supplierId, bindingStatus: 'ACTIVE' },
          data: { bindingStatus: 'REVOKED', revokedAt: now },
        });
        // certSn 列全局唯一：本供应商已撤销的同号证书复用原行置回 ACTIVE，否则新建
        const row = existing
          ? await tx.supplierCert.update({
              where: { id: existing.id },
              data: { certDn, publicKey, alg: alg ?? 'SM2', bindingStatus: 'ACTIVE', boundAt: now, revokedAt: null },
            })
          : await tx.supplierCert.create({
              data: { supplierId, certSn, certDn, publicKey, alg: alg ?? 'SM2' },
            });
        // 绑定即激活验签公钥（存量列）
        await tx.supplier.update({ where: { id: supplierId }, data: { sm2PublicKey: publicKey } });
        return row;
      });
      return { cert };
    } catch (err: any) {
      // 并发竞态（镜像 submitBid 的 try-create-catch 模式）：两请求双双越过 findUnique
      // 前置检查后，在 certSn @unique 上撞 P2002 → 转 409 锁定语义，杜绝裸 500
      if (err?.code === 'P2002') {
        throw new ConflictException({ error: '该证书序列号已被绑定', code: 'CERT_SN_EXISTS' });
      }
      throw err;
    }
  }

  /**
   * 本供应商已绑定证书列表（U盾管理页：换证/解绑 UI 需要行 id 与绑定状态，
   * 跨浏览器/跨机器导入介质后据此恢复绑定态展示）。
   */
  async listMyCerts(supplierId: string) {
    return this.prisma.supplierCert.findMany({
      where: { supplierId },
      orderBy: [{ bindingStatus: 'asc' }, { boundAt: 'desc' }],
    });
  }

  /**
   * 解绑/换证：证书置 REVOKED + revokedAt。
   * 响应附 pendingSubmissions = 依赖该 certSn 的未开标提交数（envelope 存 certSn 快照，
   * 旧标书仍需旧证书解密——UI 据此警示「须保留旧 U盾证书」）。
   */
  async revokeCert(supplierId: string, certId: string) {
    const cert = await this.prisma.supplierCert.findUnique({ where: { id: certId } });
    if (!cert) throw new BadRequestException({ error: '证书不存在', code: 'NOT_FOUND' });
    if (cert.supplierId !== supplierId) {
      throw new ForbiddenException({ error: '无权操作此证书', code: 'FORBIDDEN' });
    }
    // 幂等：已 REVOKED 直接返回统计，不重复写 revokedAt
    const updated = cert.bindingStatus === 'REVOKED'
      ? cert
      : await this.prisma.supplierCert.update({
          where: { id: certId },
          data: { bindingStatus: 'REVOKED', revokedAt: new Date() },
        });
    const pendingSubmissions = await this.prisma.supplierBidSubmission.count({
      where: {
        // Prisma Json path 过滤（envelope->>'certSn'）——certSn 全局唯一，无需再限 supplierId
        envelope: { path: ['certSn'], equals: cert.certSn },
      },
    });
    return { ...updated, pendingSubmissions };
  }

  /**
   * 管理方加密证书公钥公开查询（双信封 v2 投递端取用：供应商端用 active 公钥
   * 对 DEK 的 kadmin 分量做 SM2 外层加密，adminCertId 随 envelope 落库供轮转比对）。
   * bootstrap（AdminKeyService.ensureBootstrap）后 active 恒存在——409 仅兜底。
   */
  async getActiveAdminCert() {
    const cert = await this.prisma.adminEncryptionCert.findFirst({ where: { active: true } });
    if (!cert) {
      throw new ConflictException({ error: '管理方加密证书未初始化', code: 'ADMIN_CERT_MISSING' });
    }
    return { adminCertId: cert.id, publicKey: cert.publicKey, certDn: cert.certDn };
  }

  // ─── Contacts ───

  async listContacts(supplierId: string) {
    return this.prisma.supplierContact.findMany({
      where: { supplierId },
      orderBy: { isPrimary: 'desc' },
    });
  }

  async addContact(supplierId: string, dto: CreateContactDto) {
    return this.prisma.supplierContact.create({
      data: {
        supplierId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        isPrimary: dto.isPrimary,
        position: dto.position,
      },
    });
  }

  async updateContact(supplierId: string, contactId: string, dto: Partial<CreateContactDto>) {
    const contact = await this.prisma.supplierContact.findUnique({ where: { id: contactId } });
    if (!contact || contact.supplierId !== supplierId) {
      throw new BadRequestException({ error: '联系人不存在', code: 'NOT_FOUND' });
    }
    return this.prisma.supplierContact.update({
      where: { id: contactId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
        ...(dto.position !== undefined && { position: dto.position }),
      },
    });
  }

  async deleteContact(supplierId: string, contactId: string) {
    const contact = await this.prisma.supplierContact.findUnique({ where: { id: contactId } });
    if (!contact || contact.supplierId !== supplierId) {
      throw new BadRequestException({ error: '联系人不存在', code: 'NOT_FOUND' });
    }
    return this.prisma.supplierContact.delete({ where: { id: contactId } });
  }

  // ─── Qualifications ───

  async listQualifications(supplierId: string) {
    return this.prisma.supplierQualification.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addQualification(supplierId: string, dto: CreateQualificationDto) {
    return this.prisma.supplierQualification.create({
      data: {
        supplierId,
        type: dto.type,
        name: dto.name,
        fileUrl: dto.fileUrl,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }

  async deleteQualification(supplierId: string, qualificationId: string) {
    const qualification = await this.prisma.supplierQualification.findUnique({
      where: { id: qualificationId },
    });
    if (!qualification || qualification.supplierId !== supplierId) {
      throw new BadRequestException({ error: '资质材料不存在', code: 'NOT_FOUND' });
    }
    return this.prisma.supplierQualification.delete({ where: { id: qualificationId } });
  }

  // ─── Change Requests ───

  async listChangeRecords(supplierId: string) {
    return this.prisma.supplierChangeRecord.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createChangeRequest(supplierId: string, userId: string, dto: CreateChangeRequestDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.userId !== userId) throw new ForbiddenException({ error: '无权操作', code: 'FORBIDDEN' });
    if (supplier.status !== 'APPROVED') throw new BadRequestException({ error: '只有已入库供应商可以提交变更', code: 'INVALID_STATUS' });

    // 字段白名单校验
    if (!isSupplierChangeAllowedField(dto.fieldName)) {
      throw new BadRequestException({ error: '该字段不允许通过变更申请修改', code: 'FIELD_NOT_ALLOWED' });
    }

    const oldValue = supplier[dto.fieldName as keyof typeof supplier] as string;
    return this.prisma.supplierChangeRecord.create({
      data: {
        supplierId,
        fieldName: dto.fieldName,
        fieldLabel: dto.fieldLabel,
        oldValue,
        newValue: dto.newValue,
        reason: dto.reason,
        status: 'PENDING',
      },
    });
  }

  // ─── Evaluations ───

  async listMyEvaluations(supplierId: string) {
    return this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: {
        evaluator: { select: { id: true, displayName: true } },
      },
    });
  }

  async getEvaluationStats(supplierId: string) {
    const evaluations = await this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      select: { finalGrade: true },
    });

    const total = evaluations.length;
    const levelCounts = {
      A: evaluations.filter(e => e.finalGrade === 'A').length,
      B: evaluations.filter(e => e.finalGrade === 'B').length,
      C: evaluations.filter(e => e.finalGrade === 'C').length,
      D: evaluations.filter(e => e.finalGrade === 'D').length,
      E: evaluations.filter(e => e.finalGrade === 'E').length,
    };
    const excellentRatio = total > 0
      ? Math.round(((levelCounts['A'] + levelCounts['B']) / total) * 1000) / 10
      : 0;

    return { total, excellentRatio, levelCounts };
  }

  // ─── Bid Projects (投标机会 — supplier-facing) ───

  /** 用源项目管理的业务编号（TP-xxx / ZJ-xxx）覆盖 BidProject 内部编号（BID-时间戳），
   *  与 :3005/:3007 的 resolveDisplayCodes 行为一致。仅用于返回展示。 */
  private async resolveDisplayCode<T extends { projectManagementItemId?: string | null; projectCode?: string }>(
    project: T,
  ): Promise<T> {
    if (!project.projectManagementItemId) return project;
    const pm = await this.prisma.projectManagementItem.findUnique({
      where: { id: project.projectManagementItemId },
      select: { projectCode: true },
    });
    return pm?.projectCode ? { ...project, projectCode: pm.projectCode } : project;
  }

  /** 公告 relatedProjectCode 的候选编号集合：业务编号（PMI.projectCode，公告实际存储值）∪ 内部编号（历史数据兜底）。
   *  公告查找必须同时尝试两者——公告存业务编号（ZJ-xxx），BidProject.projectCode 是内部 BID-时间戳，
   *  仅用内部编号查找会恒空（导致详情页"暂无公告正文"、招标文件查不到）。 */
  private async resolveAnnouncementCodes(project: { projectManagementItemId?: string | null; projectCode: string }): Promise<string[]> {
    const codes = new Set<string>([project.projectCode]);
    if (project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({
        where: { id: project.projectManagementItemId },
        select: { projectCode: true },
      });
      if (pm?.projectCode) codes.add(pm.projectCode);
    }
    return [...codes];
  }

  // 仅返回项目公开字段 + 投标方数量。绝不暴露其他投标方身份、开标记录、
  // 专家名单与评分等评审内部信息（这些是 BidController 受角色保护的原因）。
  // 仅返回截止时间未到的项目；公告项目=accessScope OPEN，受邀项目=INVITED/DESIGNATED。
  async listBidProjects(
    page = 1,
    pageSize = 20,
    filters: { search?: string; scope?: string } = {},
    supplierId?: string,
  ) {
    const skip = (page - 1) * pageSize;
    const now = new Date();
    const kw = filters.search?.trim();

    // D5（CTS-EBS01 A-215）展示层闸门：黑名单主体不展示投标机会列表。
    // 仅做可见性过滤——投递等执行链端点的资格闸门不在本期范围（收窄路线图约定）。
    if (supplierId) {
      const self = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { status: true } });
      if (self?.status === 'BLACKLIST') {
        return { total: 0, page, pageSize, items: [], scopeCounts: { open: 0, invited: 0 }, blacklisted: true };
      }
    }
    const baseWhere: any = {
      isExtractionOnly: false, // 排除自定义抽取的影子项目（不进供应商投标机会列表）
      stage: { not: 'ARCHIVED' }, // 不展示已归档项目
    };

    // 可见性 + 时效：
    //  - 受邀项目（BidSupplier 命中）：谈判采购等确认参加即显示（sendNegotiationConfig 已下发时间窗口）；
    //    直接采购须等公告发布后才显示（直接采购的时间在公告里发布，确认参加仅记录意向）。
    //  - 公开公告项目（accessScope=OPEN）：仅展示 deadline 未到的活跃项目
    let invitedIds: string[] = [];
    let openIds: string[] = [];
    if (supplierId) {
      // P0-2：公开可见性 = BidDocument(OPEN) ∪ 已发布采购公告（relatedProjectCode 解析）。
      // relatedProjectCode 存的是业务编号（PMI.projectCode，如 ZJ-xxx/TP-xxx），
      // 须经 ProjectManagementItem 桥接回 BidProject（BidProject.projectCode 是内部 BID-时间戳）。
      const [invited, openDocs, openNotices] = await Promise.all([
        this.prisma.bidSupplier.findMany({ where: { supplierId }, select: { projectId: true } }),
        this.prisma.bidDocument.findMany({ where: { accessScope: 'OPEN', bidProjectId: { not: null } }, select: { bidProjectId: true } }),
        this.prisma.announcement.findMany({
          where: { type: 'BID_NOTICE', status: 'PUBLISHED', relatedProjectCode: { not: null } },
          select: { relatedProjectCode: true },
        }),
      ]);
      const rawInvitedIds = invited.map(i => i.projectId);
      openIds = openDocs.map(d => d.bidProjectId!).filter(Boolean);
      const noticeCodes = [...new Set(openNotices.map(n => n.relatedProjectCode!).filter(Boolean))];

      // 受邀项目：区分直接采购（须公告发布）与其他（确认参加即显示）
      if (rawInvitedIds.length > 0) {
        const invitedProjects = await this.prisma.bidProject.findMany({
          where: { id: { in: rawInvitedIds } },
          select: { id: true, procurementMethod: true, projectManagementItemId: true, projectCode: true },
        });
        const pmis = invitedProjects.some(p => p.projectManagementItemId)
          ? await this.prisma.projectManagementItem.findMany({
              where: { id: { in: invitedProjects.map(p => p.projectManagementItemId).filter((x): x is string => !!x) } },
              select: { id: true, projectCode: true },
            })
          : [];
        const pmCodeMap = new Map(pmis.map(pm => [pm.id, pm.projectCode]));
        const publishedCodeSet = new Set(noticeCodes);
        invitedIds = invitedProjects
          .filter(p => {
            if (p.procurementMethod !== '直接采购') return true;
            // 直接采购：业务编号（PMI.projectCode）或内部编号命中已发布公告 → 视为公告已发布
            const bizCode = p.projectManagementItemId ? pmCodeMap.get(p.projectManagementItemId) : undefined;
            return (!!bizCode && publishedCodeSet.has(bizCode)) || publishedCodeSet.has(p.projectCode);
          })
          .map(p => p.id);
      }

      // 公告已发布 → 公开项目：按业务编号（PMI.projectCode）或内部编号桥接回 BidProject
      if (noticeCodes.length > 0) {
        const pmByCode = await this.prisma.projectManagementItem.findMany({
          where: { projectCode: { in: noticeCodes } },
          select: { id: true },
        });
        const pmIds = pmByCode.map(p => p.id);
        const byCode = await this.prisma.bidProject.findMany({
          where: {
            OR: [
              { projectCode: { in: noticeCodes } },
              { projectManagementItemId: { in: pmIds } },
            ],
          },
          select: { id: true },
        });
        openIds = [...new Set([...openIds, ...byCode.map(p => p.id)])];
      }
    }

    // scope 过滤：公告项目=OPEN，受邀项目=INVITED|DESIGNATED
    let scopeIds: string[] | undefined;
    if (filters.scope) {
      const scopeValues = filters.scope === 'OPEN'
        ? ['OPEN']
        : ['INVITED', 'DESIGNATED'];
      const docs = await this.prisma.bidDocument.findMany({
        where: { accessScope: { in: scopeValues }, bidProjectId: { not: null } },
        select: { bidProjectId: true },
      });
      scopeIds = docs.map(d => d.bidProjectId!).filter(Boolean);
      if (scopeIds.length === 0) {
        return { total: 0, page, pageSize, items: [], scopeCounts: { open: 0, invited: 0 } };
      }
    }

    // 组装 OR 可见性分支：受邀 + 公开，再与 scope/keyword AND。
    // P0-2：两分支均限定 DOWNLOAD/SUBMIT——「可投标项目」只列投递期项目，
    // OPENING 及之后经「投标进展」/开标大厅跟进（此前受邀分支把 EVALUATING 项目也列为可投标）。
    const orBranches: any[] = [];
    if (supplierId) {
      if (invitedIds.length > 0) {
        const ids = scopeIds ? invitedIds.filter(id => scopeIds.includes(id)) : invitedIds;
        if (ids.length > 0) orBranches.push({ id: { in: ids }, stage: { in: ['DOWNLOAD', 'SUBMIT'] } });
      }
      if (openIds.length > 0) {
        const ids = scopeIds ? openIds.filter(id => scopeIds.includes(id)) : openIds;
        if (ids.length > 0) orBranches.push({ id: { in: ids }, deadline: { gt: now }, stage: { in: ['DOWNLOAD', 'SUBMIT'] } });
      }
    } else {
      // 无供应商上下文（防御）：沿用原"全部活跃项目"语义
      if (scopeIds) baseWhere.id = { in: scopeIds };
      baseWhere.deadline = { gt: now };
    }
    if (supplierId) {
      if (orBranches.length === 0) {
        return { total: 0, page, pageSize, items: [], scopeCounts: { open: 0, invited: 0 } };
      }
      baseWhere.OR = orBranches;
    }

    // 关键词搜索（AND）
    if (kw) {
      baseWhere.AND = baseWhere.AND || [];
      baseWhere.AND.push({
        OR: [
          { name: { contains: kw, mode: 'insensitive' } as any },
          { projectCode: { contains: kw, mode: 'insensitive' } as any },
        ],
      });
    }

    const where = baseWhere;

    const [total, items] = await Promise.all([
      this.prisma.bidProject.count({ where }),
      this.prisma.bidProject.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          projectCode: true,
          projectManagementItemId: true,
          name: true,
          procurementMethod: true,
          openTime: true,
          deadline: true,
          downloadDeadline: true,
          stage: true,
          riskNote: true,
          createdAt: true,
          _count: { select: { suppliers: true } },
        },
      }),
    ]);

    // 富化 accessScope（来自 BidDocument）供前端分类
    const projectIds = items.map(i => i.id);
    const bidDocs = projectIds.length > 0
      ? await this.prisma.bidDocument.findMany({
          where: { bidProjectId: { in: projectIds } },
          select: { bidProjectId: true, accessScope: true },
        })
      : [];
    const scopeMap: Record<string, string> = {};
    for (const d of bidDocs) {
      if (d.bidProjectId) scopeMap[d.bidProjectId] = d.accessScope;
    }
    const enrichedItems = items.map(i => ({
      ...i,
      accessScope: scopeMap[i.id] || 'OPEN',
    }));

    // 富化谈判配置（来自 Redis）：采购文件获取窗口、开标时间、下载模式、文件数
    const negoConfigs = await this.fetchNegotiationConfigs(projectIds);
    const finalItems = await Promise.all(enrichedItems.map(async i => ({
      ...await this.resolveDisplayCode(i),
      negotiation: negoConfigs[i.id] || null,
    })));

    // 按 scope 分组计数：基于 BidProject（deadline > now）+ BidDocument accessScope，
    // 保证"全部"=所有未到期项目数，与 total 一致；公告/受邀按 BidDocument 归因。
    const allProjectIds = (
      await this.prisma.bidProject.findMany({
        where: { deadline: { gt: now }, isExtractionOnly: false },
        select: { id: true },
      })
    ).map(p => p.id);
    const allBidDocs = allProjectIds.length > 0
      ? await this.prisma.bidDocument.findMany({
          where: { bidProjectId: { in: allProjectIds } },
          select: { bidProjectId: true, accessScope: true },
        })
      : [];
    const scopeByProject: Record<string, string> = {};
    for (const d of allBidDocs) {
      if (d.bidProjectId) scopeByProject[d.bidProjectId] = d.accessScope;
    }
    let openCount = 0, invitedCount = 0;
    for (const pid of allProjectIds) {
      const sc = scopeByProject[pid] || 'OPEN';
      if (sc === 'OPEN') openCount++;
      else invitedCount++;
    }
    const scopeCounts = { open: openCount, invited: invitedCount };

    return { total, page, pageSize, items: finalItems, scopeCounts };
  }

  /** 项目概览：直接读预生成缓存（采购端下发谈判配置时已 AI 融合并缓存），无实时 LLM 调用 */
  async getBidProjectOverview(projectId: string, supplierId?: string) {
    const cached = await this.redis.get(`negotiation-overview:${projectId}`).catch(() => null);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }
    // 无缓存（未下发谈判配置）：回退基础信息
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { name: true, procurementMethod: true, scope: true, riskNote: true },
    });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    return {
      overview: `${project.name}（${project.procurementMethod}）。招标范围：${project.scope || '详见采购文件'}。${project.riskNote ? `风险提示：${project.riskNote}。` : ''}`,
      notification: null,
      acquireStartTime: null,
      acquireEndTime: null,
      bidOpeningTime: null,
      downloadMode: null,
    };
  }

  /** 谈判采购文件下载：校验受邀 + 获取窗口内，解析 refFileKeys/attachFileIds 为 FileAsset 列表 */
  async getNegotiationFiles(projectId: string, supplierId: string) {
    // 校验供应商被邀请
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
    const roster = await this.prisma.bidSupplier.findUnique({
      where: { projectId_supplierName: { projectId, supplierName: supplier.name } },
    }).catch(() => null);
    if (!roster) throw new ForbiddenException({ error: '您未被邀请参与该项目', code: 'NOT_INVITED' });

    // 读 Redis 配置
    const raw = await this.redis.get(`negotiation-config:${projectId}`);
    if (!raw) throw new NotFoundException({ error: '该项目暂无谈判配置', code: 'NO_CONFIG' });
    const cfg = JSON.parse(raw);

    // 获取窗口校验
    const now = Date.now();
    const start = new Date(cfg.acquireStartTime).getTime();
    const end = new Date(cfg.acquireEndTime).getTime();
    if (!isNaN(start) && now < start) {
      throw new BadRequestException({ error: '采购文件获取尚未开始', code: 'ACQUIRE_NOT_STARTED' });
    }
    if (!isNaN(end) && now > end) {
      throw new BadRequestException({ error: '采购文件获取时间已截止', code: 'ACQUIRE_ENDED' });
    }

    // 解析文件：refFileKeys（FileAsset.key）+ attachFileIds（FileAsset.id）
    const keys: string[] = cfg.refFileKeys || [];
    const ids: string[] = cfg.attachFileIds || [];
    const [byKey, byId] = await Promise.all([
      keys.length > 0 ? this.prisma.fileAsset.findMany({ where: { key: { in: keys } }, select: { id: true, originalName: true, size: true, mimeType: true } }) : [],
      ids.length > 0 ? this.prisma.fileAsset.findMany({ where: { id: { in: ids } }, select: { id: true, originalName: true, size: true, mimeType: true } }) : [],
    ]);
    const files = [...byKey, ...byId].filter((f, i, arr) => arr.findIndex(x => x.id === f.id) === i);

    return {
      downloadMode: cfg.downloadMode || 'free',
      password: cfg.downloadMode === 'encrypted' ? cfg.downloadPassword : undefined,
      paidAmount: cfg.downloadMode === 'paid' ? cfg.paidAmount : undefined,
      acquireStartTime: cfg.acquireStartTime || null,
      acquireEndTime: cfg.acquireEndTime || null,
      bidOpeningTime: cfg.bidOpeningTime || null,
      files: files.map(f => ({ id: f.id, name: f.originalName, size: f.size, mimeType: f.mimeType, url: `/api/upload/files/${f.id}` })),
    };
  }

  /** 批量读取项目的谈判配置（Redis），返回 projectId → 配置摘要 映射 */
  private async fetchNegotiationConfigs(projectIds: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    if (projectIds.length === 0) return result;
    await Promise.all(projectIds.map(async (pid) => {
      try {
        const raw = await this.redis.get(`negotiation-config:${pid}`);
        if (!raw) return;
        const cfg = JSON.parse(raw);
        result[pid] = {
          acquireStartTime: cfg.acquireStartTime || null,
          acquireEndTime: cfg.acquireEndTime || null,
          bidOpeningTime: cfg.bidOpeningTime || null,
          downloadMode: cfg.downloadMode || 'free',
          fileCount: (cfg.refFileKeys?.length || 0) + (cfg.attachFileIds?.length || 0),
        };
      } catch { /* ignore */ }
    }));
    return result;
  }

  async getBidProject(id: string, supplierId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: {
        id: true,
        projectCode: true,
        projectManagementItemId: true,
        name: true,
        procurementMethod: true,
        openTime: true,
        deadline: true,
        downloadDeadline: true,
        stage: true,
        riskNote: true,
        isExtractionOnly: true,
        bondRequired: true,
        bondAmount: true,
        scope: true,
        qualification: true,
        contact: true,
        qualityRequirement: true,
        createdAt: true,
        clarifications: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true, question: true, issuer: true, reply: true, createdAt: true },
        },
        roundMode: true,
        currentRoundNo: true,
        _count: { select: { suppliers: true } },
      },
    });
    // 影子项目（自定义抽取）不对供应商可见
    if (project?.isExtractionOnly) {
      throw new NotFoundException({ error: '项目不存在', code: 'NOT_FOUND' });
    }
    if (project) {
      // P1-7：澄清答疑记录仅本项目投标成员可见——非成员（浏览机会的供应商）剥离，
      // 防评标期澄清答复（可能含他方商务信息）泄露给任意登录供应商（评标保密）。
      if (supplierId) {
        const member = await this.prisma.bidSupplier.findFirst({
          where: { projectId: id, supplierId },
          select: { id: true },
        });
        if (!member) {
          project.clarifications = [];
        }
      }
      // 脱敏：供应商提问(type=question)的 issuer 含竞对企业名，开标前属保密信息（防串标/围标）；
      // 管理端发起的澄清/通知(type=clarification 等)保留 issuer。
      project.clarifications = project.clarifications.map((c) => ({
        ...c,
        issuer: c.type === 'question' ? '供应商' : c.issuer,
      }));

      // 富化：查找关联的招标公告内容（relatedProjectCode + type=BID_NOTICE）。
      // 公告存业务编号（ZJ-xxx）、项目内部是 BID-时间戳——两个编号都试。
      const announcement = await this.prisma.announcement.findFirst({
        where: {
          relatedProjectCode: { in: await this.resolveAnnouncementCodes(project) },
          type: 'BID_NOTICE',
        },
        select: { title: true, content: true, summary: true, publishDate: true, metadata: true },
      });
      (project as any).announcement = announcement;

      // 无关联公告时（谈判/邀请采购以邀请书代替公告）：优先挂采购邀请书 DOCX（:3005 邀请流程
      // 导出落 MinIO 的公文，key=general/invitation/{业务编号}/{ts}.docx），详情页在线预览原文；
      // 无邀请书文件时退回 RSVP 回执摘要（title + summary 结构化字段）。
      if (!announcement) {
        const codes = await this.resolveAnnouncementCodes(project);
        const letterAsset = codes.length > 0
          ? await this.prisma.fileAsset.findFirst({
              where: { OR: codes.map((c) => ({ key: { startsWith: `general/invitation/${c}/` } })) },
              orderBy: { createdAt: 'desc' },
              select: { id: true, originalName: true },
            })
          : null;
        if (letterAsset) {
          (project as any).invitationLetter = {
            kind: 'file',
            fileAssetId: letterAsset.id,
            url: `/api/upload/files/${letterAsset.id}`,
            fileName: letterAsset.originalName,
          };
        }
      }
      if (!announcement && !(project as any).invitationLetter && supplierId && project.projectManagementItemId) {
        const rsvp = await this.prisma.invitationRsvp.findFirst({
          where: { supplierId, projectId: project.projectManagementItemId },
          orderBy: { createdAt: 'desc' },
          select: { title: true, summary: true, status: true, expiresAt: true, respondedAt: true },
        });
        if (rsvp) {
          let summaryFields: Record<string, string> | null = null;
          try {
            const parsed = typeof rsvp.summary === 'string' ? JSON.parse(rsvp.summary) : rsvp.summary;
            if (parsed && typeof parsed === 'object') summaryFields = parsed;
          } catch { /* summary 非 JSON 则不渲染字段表 */ }
          (project as any).invitationLetter = {
            kind: 'rsvp',
            title: rsvp.title,
            summaryFields,
            status: rsvp.status,
            expiresAt: rsvp.expiresAt,
            respondedAt: rsvp.respondedAt,
          };
        }
      }
    }
    // 编号覆盖放最后：公告查找已完成，仅展示层换业务编号
    if (project) return this.resolveDisplayCode(project);
    return project;
  }

  /**
   * 根据招标项目 ID 查找关联的招标文件（通过公告的 relatedProjectCode 关联），
   * 返回当前供应商的访问权限状态。无关联文件时返回 null。
   */
  async getBidProjectDocument(projectId: string, supplierId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true, projectManagementItemId: true, downloadDeadline: true },
    });
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });

    // 采购文件下载截止时间 gate：超时不可下载
    if (project.downloadDeadline && project.downloadDeadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '采购文件下载时间已截止', code: 'DOWNLOAD_DEADLINE_PASSED' });
    }

    // R-2：临时供应商权限过期禁止下载招标文件（业务侧兜底，防过期供应商获取文件）
    const self = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { isTemporary: true, temporaryExpiresAt: true },
    });
    if (self?.isTemporary && self.temporaryExpiresAt && self.temporaryExpiresAt < new Date()) {
      throw new BadRequestException({ error: '临时供应商权限已过期，无法下载', code: 'TEMPORARY_EXPIRED' });
    }

    // 查找关联的招标公告（BID_NOTICE）——公告存业务编号、项目内部是 BID-时间戳，两个编号都试
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        relatedProjectCode: { in: await this.resolveAnnouncementCodes(project) },
        type: 'BID_NOTICE',
      },
      select: { id: true },
    });
    if (!announcement) return null;

    // 检查是否已上传招标文件
    const bidDoc = await this.prisma.bidDocument.findUnique({
      where: { announcementId: announcement.id },
      select: { id: true },
    });
    if (!bidDoc) return null;

    // 委托 BidDocumentService 处理权限/付费/下载状态
    return this.bidDocumentService.getForSupplier(announcement.id, supplierId);
  }

  // ─── Bid Submissions ───

  private async assertCanSubmitBid(supplierId: string, projectId: string) {
    const [supplier, project] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: supplierId } }),
      this.prisma.bidProject.findUnique({
        where: { id: projectId },
        select: { id: true, projectCode: true, stage: true, deadline: true, projectManagementItemId: true, bondRequired: true },
      }),
    ]);

    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '供应商未通过审核，无法投标', code: 'NOT_APPROVED' });
    }
    // R-2：临时供应商过期禁止投标（draft+submit 共用入口，比 P0-3 单点更彻底）
    if (supplier.isTemporary && supplier.temporaryExpiresAt && supplier.temporaryExpiresAt < new Date()) {
      throw new BadRequestException({ error: '临时供应商权限已过期，无法投标', code: 'TEMPORARY_EXPIRED' });
    }
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '当前项目已进入开标或后续阶段，无法投递', code: 'PROJECT_NOT_SUBMITTING' });
    }
    if (project.deadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '投递截止时间已过', code: 'DEADLINE_PASSED' });
    }
    // G3 权威兜底（P0-2 放宽口径）：公告项目须已发布招标公示；邀请类采购（谈判采购等无公告阶段，
    // 供应商邀请向导替代公告）以「已接受邀请回执（InvitationRsvp ACCEPTED，projectId=PMI id）
    // 或已在候选名单（BidSupplier 行）」为投递准入，二者其一即可。
    const notice = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'BID_NOTICE', status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!notice) {
      const [inPool, acceptedRsvp] = await Promise.all([
        this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId }, select: { id: true } }),
        project.projectManagementItemId
          ? this.prisma.invitationRsvp.findFirst({
              where: { supplierId, projectId: project.projectManagementItemId, status: 'ACCEPTED' },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (!inPool && !acceptedRsvp) {
        throw new BadRequestException({ error: '该项目尚未发布招标公告，也未见您的受邀确认记录，暂无法投递', code: 'BID_NOTICE_REQUIRED' });
      }
    }

    return { supplier, project };
  }

  private async assertCanSaveBidDraft(supplierId: string, projectId: string) {
    const [supplier, project] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: supplierId } }),
      this.prisma.bidProject.findUnique({
        where: { id: projectId },
        select: { id: true, stage: true, deadline: true },
      }),
    ]);

    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '供应商未通过审核，无法保存投标草稿', code: 'NOT_APPROVED' });
    }
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '当前项目不允许保存投标草稿', code: 'PROJECT_NOT_DRAFTABLE' });
    }
    if (project.deadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '投递截止时间已过', code: 'DEADLINE_PASSED' });
    }

    return { supplier, project };
  }

  async submitBid(supplierId: string, projectId: string, data: BidSubmissionData) {
    // Check if already submitted
    const existing = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    if (existing && existing.status === 'submitted') {
      throw new BadRequestException({ error: '已提交过标书，不可重复提交', code: 'ALREADY_SUBMITTED' });
    }

    // P0-3：临时供应商权限过期禁止投标（登录拦截外的业务侧兜底，防投标后过期）
    // W9-②（CTS A-215）：黑名单主体禁止投递——业务侧兜底（登录不拦，投递/下载硬拒）
    const self = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { isTemporary: true, temporaryExpiresAt: true, status: true },
    });
    if (self?.status === 'BLACKLIST') {
      throw new ForbiddenException({ error: '贵单位已被列入黑名单，禁止参与投标', code: 'SUPPLIER_BLACKLISTED' });
    }
    if (self?.isTemporary && self.temporaryExpiresAt && self.temporaryExpiresAt < new Date()) {
      throw new BadRequestException({ error: '临时供应商权限已过期，无法投标', code: 'TEMPORARY_EXPIRED' });
    }

    // P0-1：前端「完整标书/拆分文件」字段归一到三角色契约，否则 pickBidSubmissionFields 丢弃 → 标书丢失 → 流标。
    normalizeBidFileAssets(data);

    const { supplier, project } = await this.assertCanSubmitBid(supplierId, projectId);
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
      data.bidBondAssetId,
    ]);

    // ── 双信封 v2 新轨开关（Task 9）：默认开；BID_DUAL_ENVELOPE=false 全局退回旧轨（灰度/应急双向可退）──
    const dualOn = process.env.BID_DUAL_ENVELOPE !== 'false';
    const envelope = data.envelope;
    const dual = dualOn && envelope?.version === 'dual-v2';
    // flag 关但客户端按新轨投递（文件已是双层密文 + dual-v2 信封）：旧轨会因缺 clientDeks 以
    // 隐晦 MISSING_CLIENT_DEK 拒收，应急开关形同虚设——显式拒收并指引按旧流程投递（fix round 1 ②）。
    if (!dualOn && envelope?.version === 'dual-v2') {
      throw new BadRequestException({
        error: '平台暂未启用双层信封，请按旧流程投递或联系管理员',
        code: 'DUAL_DISABLED',
      });
    }
    // 旧轨/flag 关/版本不符：剥离 envelope，永不落库——管理方公钥公开、信封格式可伪造良好，
    // 未经验签的信封若以 envelopeVersion='dual-v2' 存库，flag 回开后下游（T10+）按版本分派会误信。
    if (!dual) data.envelope = undefined;

    // P1-1：旧轨代解密授权记录——主持人代解密的投标人须在投递时显式授权（办法第30条
    // 「按招标文件规定方式」的授权留痕）；新轨供应商自解（dual-v2）无需授权。仅 submit 强制，
    // 草稿不拦。存量数据 flag=false 仅表示记录缺失，不阻断解密（记录语义非闸门）。
    if (!dual && data.hostDecryptAuthorized !== true) {
      throw new BadRequestException({
        error: '未勾选「同意平台在开标环节代为解密投标文件」授权，无法提交（依据招标文件规定的解密方式）',
        code: 'HOST_DECRYPT_CONSENT_REQUIRED',
      });
    }

    // ── Layer C: SM2 digital signature verification (anti-repudiation) ──
    // TODO (Phase 6): 当前前端 BidSubmit.vue 未实现 SM2 客户端签名，
    // 因此 signature/fileHash 始终为空，此验证跳过。
    // 需在客户端实现：计算标书文件 SHA-256 → 用供应商 SM2 私钥签名 → 随提交发送。
    // dual-v2 新轨的验签在下方新轨分支内按「ACTIVE SupplierCert 收紧口径」执行，不走本段。
    if (!dual && data.signature && data.fileHash) {
      const pubKey = supplier.sm2PublicKey;
      if (!pubKey) {
        throw new BadRequestException({ error: '供应商未配置 SM2 公钥，无法验签', code: 'SM2_PUBLIC_KEY_MISSING' });
      }
      const isValid = this.signatureService.verify(data.fileHash, data.signature, pubKey);
      if (!isValid) {
        throw new BadRequestException({ error: '数字签名验证失败：标书文件哈希与签名不匹配', code: 'SM2_SIGNATURE_INVALID' });
      }
    }

    // ── Layer B: encrypt submitted bid files at rest (new sealed path, no overwrite) ──
    const assetIds = [data.technicalFileAssetId, data.businessFileAssetId, data.coverLetterAssetId].filter(Boolean) as string[];
    const sealedKeys: Record<string, string> = {};
    const sealedPaths: Record<string, string> = {};
    const newlySealedPaths: string[] = []; // for cleanup on failure
    const assetRoles: Record<string, BackupFileRole> = {};
    if (data.technicalFileAssetId) assetRoles[data.technicalFileAssetId] = 'technical';
    if (data.businessFileAssetId) assetRoles[data.businessFileAssetId] = 'business';
    if (data.coverLetterAssetId) assetRoles[data.coverLetterAssetId] = 'coverLetter';
    const stagedBackups: StagedBackup[] = []; // 提交时即备份（未解密态），best-effort
    let canonicalHash: string | undefined; // dual-v2：envelope 规范哈希（fileHash 落库锚点）

    if (dual) {
      // ── dual-v2 新轨（Task 9）：C_outer 已由客户端双层加密上传（asset.key 即密文），服务端只验不加密 ──
      // 拒收顺序：管理方证书 → 逐角色密封件 → 证书验签（收紧口径）；任一失败 400 拒收、零落库零备份。
      const env = envelope as DualEnvelope;
      // ① 管理方加密证书在位且与信封一致：投递后证书轮换会使外层（kadmin）无人可解，须拒收重加密上传。
      const activeCert = await this.prisma.adminEncryptionCert.findFirst({ where: { active: true } });
      if (!activeCert || env.adminCertId !== activeCert.id) {
        throw new BadRequestException({ error: '管理方加密证书已变更，请重新加密上传', code: 'ADMIN_CERT_CHANGED' });
      }
      // ② 逐角色拒收：每个已投递角色（bond 仅 bondRequired 时参检）的 asset 必须 clientEncrypted，
      //    且信封条目 sha256 == asset.sha256（明文哈希一致——防调包/漏封）。
      //    declared 由服务端从投递声明枚举全部期望角色（assertEnvelopeIntact 单向：declared→envelope）。
      const declared: Array<{ role: EnvelopeRole; sha256: string }> = [];
      for (const [role, idKey] of DUAL_ROLE_FIELDS) {
        const assetId = data[idKey] as string | undefined;
        if (!assetId) continue; // 该角色未投递 → 无锚点可校
        if (role === 'bond' && !project.bondRequired) continue;
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
        if (!asset?.clientEncrypted) {
          throw new BadRequestException({
            error: `投标文件未按双层信封加密（${role}），请重新加密上传`,
            code: 'BID_FILE_NOT_ENCRYPTED',
          });
        }
        declared.push({ role, sha256: asset.sha256 });
      }
      this.dualEnvelope.assertEnvelopeIntact(env, declared);
      // ③ 验签（收紧口径）：envelope.certSn 必须命中本供应商 ACTIVE SupplierCert；
      //    不回退 supplier.sm2PublicKey 列——revokeCert 不清该列，回退会让已撤销证书的旧公钥继续有效。
      const cert = await this.prisma.supplierCert.findFirst({
        where: { supplierId, certSn: env.certSn, bindingStatus: 'ACTIVE' },
      });
      const verified = cert
        ? await this.dualEnvelope.verifySignature(env, data.signature ?? '', cert.publicKey)
        : false;
      if (!cert || !verified) {
        throw new BadRequestException({ error: '未找到有效绑定证书或签名验证失败', code: 'SM2_SIGNATURE_INVALID' });
      }
      canonicalHash = await canonicalEnvelopeHash(env);
      // ④ 新轨报价只存在于 sealedFields（供应商层密文，平台开标解密前不可读）——不写 KMS 密封 bidPrice 列。
      data.bidPrice = undefined;
      // ④b bond（bondRequired 时已过 ② 校验）与三标书角色同入备份/封存循环；
      //     assetIds 仅新轨追加，旧轨路径不变（旧轨 bond 为程序性明文文件，不加密不备份）。
      const bondAssetId = project.bondRequired ? data.bidBondAssetId : undefined;
      if (bondAssetId && !assetIds.includes(bondAssetId)) {
        assetIds.push(bondAssetId);
        assetRoles[bondAssetId] = 'bond';
      }
      // ⑤ 备份 v2（无二次加密）：sealedPath=asset.key（C_outer 即上传路径），
      //    wrappedDek=JSON{kself,kadmin,adminCertId}——kself 供供应商解密回执、kadmin 供主持端解外层，
      //    两把密钥合账方可完整解密，单独一把对任何一方均不可读明文。
      try {
        for (const assetId of assetIds) {
          const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
          if (!asset) continue;
          const entry = env.files[assetRoles[assetId]]!;
          const wrappedDek = JSON.stringify({ kself: entry.kself, kadmin: entry.kadmin, adminCertId: activeCert.id });
          sealedKeys[assetId] = wrappedDek;
          sealedPaths[assetId] = asset.key; // C_outer 即上传路径（与 E2EE 分支同口径）
          const staged = await this.bidBackup.stageBackup({
            projectId, supplierId,
            fileRole: assetRoles[assetId],
            fileAssetId: assetId,
            sealedPath: asset.key,
            ciphertext: await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, asset.key)),
            wrappedDek,
            plaintextSha256: asset.sha256 ?? null,
          });
          if (staged) {
            stagedBackups.push(staged);
            newlySealedPaths.push(staged.backupKey);
          }
        }
      } catch (err) {
        // Clean up any newly written backup objects on failure（不动 asset.key 原密文）
        for (const path of newlySealedPaths) {
          try { await minioClient.removeObject(MINIO_BUCKET, path); } catch (_) { /* best-effort cleanup */ }
        }
        throw err;
      }
    } else {
      // ── 旧轨（flag 关或未传 dual-v2 envelope）：E2EE/服务端加密循环，行为与代码保持原样
      //    （块体未随嵌套重排缩进，使 git diff 对旧轨零改动可直接目视核验）──
    try {
      for (const assetId of assetIds) {
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
        if (!asset) continue;

        if (asset.clientEncrypted) {
          // ── E2EE 分支：文件由客户端加密，密文已在 MinIO（asset.key），跳过 encryptBuffer ──
          const clientDek = data.clientDeks?.[assetId];
          if (!clientDek) {
            throw new BadRequestException({
              error: `客户端加密文件缺少 DEK (assetId: ${assetId})`,
              code: 'MISSING_CLIENT_DEK',
            });
          }
          // 校验 DEK 格式：三段 hex，冒号分隔
          const parts = clientDek.split(':');
          if (parts.length !== 3 || parts.some(p => !/^[0-9a-f]+$/i.test(p))) {
            throw new BadRequestException({
              error: `客户端 DEK 格式无效 (assetId: ${assetId})`,
              code: 'INVALID_CLIENT_DEK',
            });
          }
          sealedKeys[assetId] = wrapKey(clientDek, process.env.KMS_SECRET!);
          sealedPaths[assetId] = asset.key; // 密文即上传路径

          // ── 备份：读取密文 → 拷贝到 sealed-backup ──
          const staged = await this.bidBackup.stageBackup({
            projectId, supplierId, fileRole: assetRoles[assetId],
            fileAssetId: assetId,
            sealedPath: asset.key, // E2EE: sealedPath = asset.key
            ciphertext: await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, asset.key)),
            wrappedDek: sealedKeys[assetId],
            plaintextSha256: asset.sha256 ?? null, // 客户端传入的原文哈希
          });
          if (staged) {
            stagedBackups.push(staged);
            newlySealedPaths.push(staged.backupKey);
          }
        } else {
          // ── 现有服务端加密分支（不变）──
          const objStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
          const plaintext = await streamToBuffer(objStream);

          const { ciphertext, decryptKey } = encryptBuffer(plaintext);
          sealedKeys[assetId] = wrapKey(decryptKey, process.env.KMS_SECRET!);

          // Write ciphertext to a NEW path (do not overwrite original plaintext)
          const sealedPath = `sealed/${projectId}/${supplierId}/${asset.key.split('/').pop()}.enc`;
          await minioClient.putObject(MINIO_BUCKET, sealedPath, ciphertext, ciphertext.length, {
            'Content-Type': 'application/octet-stream',
          });
          sealedPaths[assetId] = sealedPath;
          newlySealedPaths.push(sealedPath);

          // ── 未解密备份：复用内存密文 best-effort 备份到独立前缀；失败不阻断提交（交后台补备）──
          const staged = await this.bidBackup.stageBackup({
            projectId, supplierId, fileRole: assetRoles[assetId],
            fileAssetId: assetId, sealedPath, ciphertext,
            wrappedDek: sealedKeys[assetId], plaintextSha256: asset.sha256 ?? null,
          });
          if (staged) {
            stagedBackups.push(staged);
            newlySealedPaths.push(staged.backupKey); // 失败回滚时一并清理备份对象
          }
        }
      }
    } catch (err) {
      // Clean up any newly written sealed files on failure
      // E2EE files: only clean up backup paths, not asset.key (original upload)
      for (const path of newlySealedPaths) {
        try {
          await minioClient.removeObject(MINIO_BUCKET, path);
        } catch (_) { /* best-effort cleanup */ }
      }
      throw err;
    }
    }

    const now = new Date();
    // dual-v2：BidSupplier 加密状态文案分轨（新轨=信封已验签，旧轨=KMS 密封已校验）
    const bidSupplierEncryptStatus = dual ? '双层信封已验签' : '密文已校验';
    // dual-v2 落库附加：fileHash 锚点=envelope 规范哈希（旧轨=客户端文件哈希）、signedAt 以服务端时间为准。
    const dualPersist = dual
      ? { envelopeVersion: 'dual-v2', fileHash: canonicalHash, signature: data.signature ?? null, signedAt: now }
      : {};

    // 提交记录 + fileAsset 封存标记原子化：此前分散写，中途失败会留「sealed 文件已写但 submission 未建」的不一致态。
    // 并发重复提交命中 supplierId_projectId 唯一约束（P2002）→ 转 409 并清理本次新写的 sealed 文件，杜绝孤儿对象与裸 500。
    let submission;
    try {
      submission = await this.prisma.$transaction(async (tx) => {
        for (const assetId of assetIds) {
          if (sealedPaths[assetId]) {
            await tx.fileAsset.update({
              where: { id: assetId },
              data: { encrypted: true, sealedPath: sealedPaths[assetId] },
            });
          }
        }
        let submission;
        if (existing) {
          submission = await tx.supplierBidSubmission.update({
            where: { id: existing.id },
            data: {
              ...pickBidSubmissionFields(data),
              ...dualPersist,
              status: 'submitted',
              submittedAt: now,
              serverSubmittedAt: now,
              technicalSealedKey: data.technicalFileAssetId ? sealedKeys[data.technicalFileAssetId] ?? null : null,
              businessSealedKey: data.businessFileAssetId ? sealedKeys[data.businessFileAssetId] ?? null : null,
              coverLetterSealedKey: data.coverLetterAssetId ? sealedKeys[data.coverLetterAssetId] ?? null : null,
            },
          });
        } else {
          submission = await tx.supplierBidSubmission.create({
            data: {
              supplierId,
              projectId,
              ...pickBidSubmissionFields(data),
              ...dualPersist,
              status: 'submitted',
              submittedAt: now,
              serverSubmittedAt: now,
              technicalSealedKey: data.technicalFileAssetId ? sealedKeys[data.technicalFileAssetId] ?? null : null,
              businessSealedKey: data.businessFileAssetId ? sealedKeys[data.businessFileAssetId] ?? null : null,
              coverLetterSealedKey: data.coverLetterAssetId ? sealedKeys[data.coverLetterAssetId] ?? null : null,
            },
          });
        }

        // #21 BidSupplier 一并纳入事务：此前在事务外，submission 已成后此处失败会留状态不一致且无补偿。
        const existingBidSupplier = await tx.bidSupplier.findFirst({
          where: { projectId, supplierName: supplier.name },
        });
        let receiptNo: string | null = existingBidSupplier?.receiptNo ?? null;
        if (existingBidSupplier) {
          await tx.bidSupplier.update({
            where: { id: existingBidSupplier.id },
            data: { supplierId, submitStatus: '已提交', encryptStatus: bidSupplierEncryptStatus },
          });
        } else {
          receiptNo = `TB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
          await tx.bidSupplier.create({
            data: {
              projectId,
              supplierId,
              supplierName: supplier.name,
              downloadStatus: '已下载',
              submitStatus: '已提交',
              encryptStatus: bidSupplierEncryptStatus,
              receiptNo,
            },
          });
        }

        // ── 固化未解密备份：把封标时 staged 的密文备份写入 BidFileBackup（事务内，幂等 upsert）──
        // dual-v2：wrappedDek=双 DEK JSON，cryptoVersion 标 'dual-envelope-v2'（解密/核验方据此分轨）。
        for (const staged of stagedBackups) {
          await this.bidBackup.persistBackup(tx, staged, {
            projectId, supplierId, receiptNo, submittedAt: now, backupSource: 'submission',
            ...(dual ? { cryptoVersion: 'dual-envelope-v2' } : {}),
          });
        }

        return submission;
      });
    } catch (err) {
      // 事务失败：清理本次新写的 sealed 密文，避免 MinIO 孤儿对象。
      for (const path of newlySealedPaths) {
        try { await minioClient.removeObject(MINIO_BUCKET, path); } catch (_) { /* best-effort */ }
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: '该标书已提交，请勿重复提交', code: 'ALREADY_SUBMITTED' });
      }
      throw err;
    }

    return submission;
  }

  async saveBidDraft(supplierId: string, projectId: string, data: BidSubmissionData) {
    const { supplier } = await this.assertCanSaveBidDraft(supplierId, projectId);
    normalizeBidFileAssets(data); // P0-1：归一前端完整/拆分模型
    // dual-v2：信封验签是 submitBid 新轨专属——草稿不做验签，envelope 一律剥离不落库（防伪造信封暂存）。
    data.envelope = undefined;
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
      data.bidBondAssetId,
    ]);

    const existing = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });

    if (existing) {
      return this.prisma.supplierBidSubmission.update({
        where: { id: existing.id },
        data: pickBidSubmissionFields(data),
      });
    }

    return this.prisma.supplierBidSubmission.create({
      data: { supplierId, projectId, ...pickBidSubmissionFields(data), status: 'draft' },
    });
  }

  /** A-88：删除未递交的投标草稿。与保存草稿同闸门（截止前）；已提交须走撤回（withdrawSubmission）。 */
  async deleteBidDraft(supplierId: string, projectId: string) {
    await this.assertCanSaveBidDraft(supplierId, projectId);
    const existing = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    if (!existing) throw new BadRequestException({ error: '草稿不存在', code: 'DRAFT_NOT_FOUND' });
    if (existing.status !== 'draft') {
      throw new BadRequestException({ error: '已递交的标书不可删除，请使用撤回', code: 'DRAFT_NOT_DELETABLE' });
    }
    await this.prisma.supplierBidSubmission.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  /**
   * 新轨补传（双信封 v2 · Task 10）：dual-v2 解密异常恢复走供应商端双层重封。
   * 与旧轨 reuploadBidFile 的本质差异：C_outer 是客户端双层加密产物（C_inner=SM4(DEK_S) → C_outer=SM4(DEK_A)），
   * 服务端无任何一把 DEK 明文，KMS 重封管线不可用——重新双层加密由供应商客户端完成，
   * 本端点 multipart 的 file 字段收的就是新 C_outer 密文（非明文），另交重签后的整体新 envelope 与 signature。
   *
   * 门控：供应商本人（supplierId 由登录态解析，submission 以 supplierId_projectId 定位）+ 阶段 OPENING +
   * 已提交 dual-v2 submission + 该 role 的 FileAsset 在位且有 sha256。
   * SHA-256 闸门（镜像旧轨拦截块语义）：新信封 files[role].sha256（新明文哈希声明）必须 == 原始 FileAsset.sha256
   * （明文锚点）——密文可重封、明文不可替换；不符 → 400 FILE_HASH_MISMATCH + 监督日志「新轨补传拦截」+ WS 异常事件。
   * 验签链（收紧口径，同 submitBid）：active 管理方证书匹配 adminCertId → certSn 命中本供应商 ACTIVE SupplierCert →
   * canonicalEnvelopeHash SM2 验签 → fieldsCommit/fieldsSha256 与投递锚点逐字相等（Critical：开标期不得借补传改价）
   * → assertEnvelopeIntact 全量 declared（多角色保全：他角色密封件不得在整体替换中丢失）。
   * 恢复：新 C_outer 落 MinIO（dual-reupload/ 前缀，不覆盖原密文）→ FileAsset.sealedPath 指新密文
   * （sha256 明文锚点不动、clientEncrypted 保持）→ submission 更新 envelope/signature/fileHash（canonicalEnvelopeHash）/
   * signedAt → bidSupplier 重置 decryptStatus PENDING / decryptError null → 监督日志「新轨补传（供应商端双层重封）」。
   * 自动重解密：Task 12 decrypt-outer / Task 13 decrypt-upload 的幂等管线落地后自然覆盖，本端点不重复触发。
   */
  async reuploadDualEnvelope(
    supplierId: string,
    projectId: string,
    input: {
      role: string;
      envelopeJson: string;        // 整体新 envelope（multipart text field，JSON string）
      signature?: string;          // 供应商证书私钥对 canonicalEnvelopeHash(新 envelope) 的 SM2 签名
      ciphertext: Buffer;          // 新 C_outer（客户端重新双层加密产物，非明文）
      ciphertextSha256?: string;   // 可选：客户端自报密文哈希（传输完整性，提供即校验）
    },
  ): Promise<{ recovered: true; message: string }> {
    // ── 角色字段映射（同旧轨 reuploadBidFile 三角色；bond 为程序性文件不入恢复通道）──
    const ROLE_MAP = {
      technical:   { assetIdKey: 'technicalFileAssetId' },
      business:    { assetIdKey: 'businessFileAssetId' },
      coverLetter: { assetIdKey: 'coverLetterAssetId' },
    } as const;
    const fields = ROLE_MAP[input.role as keyof typeof ROLE_MAP];
    if (!fields) throw new BadRequestException({ error: '无效文件角色', code: 'INVALID_ROLE' });

    // ── 阶段门：仅 OPENING（评标开始后锁死，同旧轨）──
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, bondRequired: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ForbiddenException({ error: '仅开标阶段可补传投标文件', code: 'STAGE_NOT_OPENING' });
    }

    // ── 成员 + 投递记录（供应商本人：supplierId 源自登录态，天然无法冒名）──
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    if (!submission || submission.status !== 'submitted') {
      throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });
    }
    if (submission.envelopeVersion !== 'dual-v2') {
      throw new BadRequestException({ error: '旧轨项目请走主持端补传通道', code: 'NOT_DUAL_TRACK' });
    }

    // ── 原始明文锚点：该 role 的 FileAsset 须在位且有 sha256 ──
    const assetId = submission[fields.assetIdKey] as string | null;
    if (!assetId) throw new BadRequestException({ error: `缺少${input.role} 文件引用`, code: 'NO_FILE_REF' });
    const originalAsset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (!originalAsset || !originalAsset.sha256) {
      throw new BadRequestException({ error: '原始文件记录缺失，无法校验', code: 'FILE_RECORD_MISSING' });
    }

    // ── 解析新信封（multipart text field 传 JSON string）──
    let envelope: DualEnvelope;
    try {
      const parsed = JSON.parse(input.envelopeJson);
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 'dual-v2'
        || typeof parsed.certSn !== 'string' || typeof parsed.adminCertId !== 'string'
        || typeof parsed.fieldsCommit !== 'string'
        || !parsed.sealedFields || typeof parsed.sealedFields !== 'object'
        || !parsed.files || typeof parsed.files !== 'object') {
        throw new Error('bad envelope shape');
      }
      envelope = parsed;
    } catch {
      throw new BadRequestException({ error: '信封格式无效（须为 dual-v2 JSON）', code: 'INVALID_ENVELOPE' });
    }

    // ── SHA-256 安全闸门：新信封声明的新明文哈希必须与原始标书明文一致（密文可重封、明文不可替换）──
    const entry = envelope.files[input.role as EnvelopeRole];
    if (!entry || entry.sha256 !== originalAsset.sha256) {
      const detail = !entry
        ? `新信封缺少 ${input.role} 密封件条目`
        : `${input.role} 文件明文 SHA-256 与原始标书不一致`;
      this.logger.warn(`reupload-dual SHA-256 mismatch: supplier=${bidSupplier.supplierName} role=${input.role} original=${originalAsset.sha256} declared=${entry?.sha256 ?? '(missing)'}`);
      // 安全事件审计：疑似标书替换尝试，通知监督端（镜像旧轨 reupload 拦截块语义）
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '供应商', target: bidSupplier.supplierName,
          action: '新轨补传拦截', result: `${detail}，拒绝恢复（疑似替换尝试）`, riskFlag: '高风险' },
      }).catch(() => {});
      this.gateway?.notifyAnomaly(projectId, {
        type: 'tamper_attempt', supplierId: bidSupplier.id, supplierName: bidSupplier.supplierName,
        detail: `${input.role} 新轨补传被拦截：${detail}`, severity: 'danger',
      });
      throw new BadRequestException({
        error: !entry
          ? `${detail}，拒绝恢复`
          : '新信封明文哈希与原始标书不一致（SHA-256 不匹配），疑似非原始文件，拒绝恢复',
        code: 'FILE_HASH_MISMATCH',
      });
    }

    // ── 验签链（收紧口径，同 submitBid）：管理方证书 → ACTIVE SupplierCert → SM2 验签 ──
    // signature 缺失在入口显式拒收，不以空串冒充「验签失败」。
    if (!input.signature) {
      throw new BadRequestException({ error: '缺少签名或签名验证失败', code: 'SM2_SIGNATURE_INVALID' });
    }
    const activeCert = await this.prisma.adminEncryptionCert.findFirst({ where: { active: true } });
    if (!activeCert || envelope.adminCertId !== activeCert.id) {
      throw new BadRequestException({ error: '管理方加密证书已变更，请重新加密上传', code: 'ADMIN_CERT_CHANGED' });
    }
    const cert = await this.prisma.supplierCert.findFirst({
      where: { supplierId, certSn: envelope.certSn, bindingStatus: 'ACTIVE' },
    });
    const verified = cert
      ? await this.dualEnvelope.verifySignature(envelope, input.signature, cert.publicKey)
      : false;
    if (!cert || !verified) {
      throw new BadRequestException({ error: '未找到有效绑定证书或签名验证失败', code: 'SM2_SIGNATURE_INVALID' });
    }

    // ── Critical（spec v6 §5.6）：唱标字段密封件不得变更——补传仅恢复文件，不得重签价格信封。
    //    开标期供应商可先听他人唱标，再借「补传」重算 fieldsCommit/fieldsSha256 并用自己证书重签
    //    （签名链完全合法，SHA 闸门只锁 files[role] 拦不住）——新信封 fieldsCommit 与
    //    sealedFields.fieldsSha256 必须与投递时 submission.envelope 原值逐字相等，不等即拒收。
    const originalEnvelope = (submission.envelope ?? null) as DualEnvelope | null;
    if (!originalEnvelope?.fieldsCommit || !originalEnvelope.sealedFields?.fieldsSha256
      || envelope.fieldsCommit !== originalEnvelope.fieldsCommit
      || envelope.sealedFields.fieldsSha256 !== originalEnvelope.sealedFields.fieldsSha256) {
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '供应商', target: bidSupplier.supplierName,
          action: '新轨补传拦截', result: `${input.role} 唱标字段密封件（fieldsCommit/fieldsSha256）与投递时不一致，拒绝恢复（疑似借补传改价）`, riskFlag: '高风险' },
      }).catch(() => {});
      throw new BadRequestException({ error: '唱标字段密封件不得变更（补传仅恢复文件）', code: 'FIELDS_COMMIT_CHANGED' });
    }

    // ── 多角色保全：单角色补传不得整体替换信封——submission 每个非空 assetId 的角色
    //    （technical/business/coverLetter + bondRequired 时的 bond），新信封对应条目必须在位且
    //    sha256 等于该 FileAsset 明文锚点（assertEnvelopeIntact 全量 declared，防客户端 JSON
    //    整体替换时静默丢失他角色密封件）──
    const ROLE_ASSET_KEYS = {
      technical: 'technicalFileAssetId', business: 'businessFileAssetId',
      coverLetter: 'coverLetterAssetId', bond: 'bidBondAssetId',
    } as const;
    const declared: Array<{ role: EnvelopeRole; sha256: string }> = [];
    for (const [role, key] of Object.entries(ROLE_ASSET_KEYS) as Array<[EnvelopeRole, (typeof ROLE_ASSET_KEYS)[EnvelopeRole]]>) {
      if (role === 'bond' && !project.bondRequired) continue;
      const rid = submission[key] as string | null;
      if (!rid) continue;
      if (rid === assetId) {
        declared.push({ role, sha256: originalAsset.sha256 }); // 补传角色：锚点已取，免重复查询
        continue;
      }
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: rid } });
      if (!asset?.sha256) {
        throw new BadRequestException({ error: '原始文件记录缺失，无法校验', code: 'FILE_RECORD_MISSING' });
      }
      declared.push({ role, sha256: asset.sha256 });
    }
    this.dualEnvelope.assertEnvelopeIntact(envelope, declared);

    // ── 传输完整性（可选）：客户端自报密文哈希与上传密文比对 ──
    const ciphertextSha = crypto.createHash('sha256').update(input.ciphertext).digest('hex');
    if (input.ciphertextSha256 && input.ciphertextSha256 !== ciphertextSha) {
      throw new BadRequestException({ error: '上传密文哈希与自报值不一致（传输损坏或截断）', code: 'CIPHERTEXT_HASH_MISMATCH' });
    }

    // ── 新 C_outer 落 MinIO（独立 dual-reupload/ 前缀，不覆盖原密文——保留存证）──
    const sealedPath = `dual-reupload/${projectId}/${supplierId}/${input.role}-${Date.now()}.enc`;
    try {
      await minioClient.putObject(MINIO_BUCKET, sealedPath, input.ciphertext, input.ciphertext.length, {
        'Content-Type': 'application/octet-stream',
      });
    } catch (err) {
      this.logger.error(`reupload-dual MinIO putObject failed: ${sealedPath}`, (err as Error).stack);
      throw new BadRequestException({ error: '文件存储失败，请重试', code: 'STORAGE_FAILED' });
    }

    // ── 事务：FileAsset 指新密文 + submission 换信封 + bidSupplier 重置 PENDING + 监督日志 ──
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // sha256 明文锚点不动；clientEncrypted 保持 true——新密文仍是客户端双层加密产物（区别于旧轨服务端重加密置 false）
      await tx.fileAsset.update({
        where: { id: assetId },
        data: { sealedPath, encrypted: true },
      });
      await tx.supplierBidSubmission.update({
        where: { supplierId_projectId: { supplierId, projectId } },
        data: {
          envelope: envelope as unknown as Prisma.InputJsonValue,
          signature: input.signature ?? null,
          fileHash: await canonicalEnvelopeHash(envelope),
          signedAt: now,
          // T12 契约（原注释钉死）：补传换新 C_outer 后必须重置解外层标记——
          // 否则 decrypt-outer 的幂等跳过会因旧标记残留而永久跳过新 C_outer，旧 C_inner 归属链永不刷新。
          outerDecryptedAt: null,
          innerAssets: Prisma.DbNull,
        },
      });
      await tx.bidSupplier.update({
        // T12 契约钉死：若 decrypt-outer（Task 12）新增 outerDecryptedAt/packageFetchedAt 等标记列，
        // 本端点必须同步重置——否则其幂等跳过逻辑会因旧标记残留而跳过补传后的新 C_outer，旧 C_inner 永不刷新。
        where: { id: bidSupplier.id },
        data: { decryptStatus: 'PENDING', decryptError: null, decryptedAt: null },
      });
      await tx.bidSupervisionLog.create({
        data: { projectId, time: now, role: '供应商', target: bidSupplier.supplierName,
          action: '新轨补传（供应商端双层重封）', result: `${input.role} 文件已恢复（明文 SHA-256 一致，信封已重签）`, riskFlag: '高风险' },
      });
    });
    this.gateway?.notifySupervisionLog(projectId, {
      role: '供应商', action: '新轨补传（供应商端双层重封）', target: bidSupplier.supplierName,
      result: `${input.role} 文件已恢复（明文 SHA-256 一致，信封已重签）`, riskFlag: '高风险',
    });

    return { recovered: true, message: '已恢复，请等待开标解密' };
  }

  /* ═══ Task 13：供应商解内层（dual-v2）—— opening-package + decrypt-upload ═══ */

  /**
   * 供应商取开标解密包：C_inner 下载凭证 + K_self（U盾解 DEK_S）+ sealedFields（U盾解 DEK_F）
   * + 窗口状态。门控（同 decryptSupplier/T12 口径）：成员（BidSupplier 存在）+ OPENING + 会话存在
   * + 窗口开未暂停 + 外层已解（outerDecryptedAt/innerAssets 非空）。
   * 成功即幂等写 packageFetchedAt（条件更新，已有不重复写——§5.5 归因矩阵的取包事实锚点）。
   */
  async getOpeningPackage(supplierId: string, projectId: string) {
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId } });
    if (!bidSupplier) {
      throw new ForbiddenException({ error: '未参与该项目，无权获取开标解密包', code: 'NOT_PROJECT_MEMBER' });
    }
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法获取解密包', code: 'PROJECT_NOT_OPENING' });
    }
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) {
      throw new BadRequestException({ error: '开标尚未启动，无法获取解密包', code: 'OPENING_NOT_STARTED' });
    }
    if (session.pausedAt) {
      throw new BadRequestException({ error: '开标已暂停，解密操作暂时禁止', code: 'OPENING_PAUSED' });
    }
    const now = new Date();
    if (now < session.decryptWindowStart) {
      throw new BadRequestException({ error: '解密窗口尚未开启', code: 'DECRYPT_WINDOW_NOT_OPEN' });
    }
    if (now > session.decryptWindowEnd) {
      throw new BadRequestException({ error: '解密窗口已关闭', code: 'DECRYPT_WINDOW_CLOSED' });
    }

    // ── A-109a 签到 quorum 闸门（窗口校验后）：已签到且已递交不足法定家数 → 禁止进入解密 ──
    await assertDecryptCheckInQuorum(this.prisma, projectId);

    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    if (!submission || submission.status !== 'submitted') {
      throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });
    }
    if (submission.envelopeVersion !== 'dual-v2') {
      throw new BadRequestException({ error: '该供应商走旧轨（单层）加密，无解密包', code: 'NOT_DUAL_TRACK' });
    }
    if (!submission.outerDecryptedAt || !submission.innerAssets) {
      throw new BadRequestException({ error: '外层尚未解密，解密包未就绪', code: 'OUTER_NOT_DECRYPTED' });
    }
    const envelope = (submission.envelope ?? null) as DualEnvelope | null;
    if (!envelope?.files || !envelope.sealedFields) {
      throw new BadRequestException({ error: '信封缺失，无法组装解密包', code: 'ENVELOPE_MISSING' });
    }

    const innerEntries = (Object.entries(submission.innerAssets as Record<string, unknown>))
      .filter(([, assetId]) => !!assetId) as Array<[EnvelopeRole, string]>;
    if (innerEntries.length === 0) {
      throw new BadRequestException({ error: '外层尚未解密，解密包未就绪', code: 'OUTER_NOT_DECRYPTED' });
    }
    const files: Array<{ role: EnvelopeRole; assetId: string; downloadUrl: string; ciphertextSha256: string }> = [];
    const kselfByRole: Record<string, string> = {};
    for (const [role, assetId] of innerEntries) {
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
      if (!asset) {
        throw new BadRequestException({ error: `解密包文件记录缺失: ${assetId}`, code: 'FILE_RECORD_MISSING' });
      }
      // ciphertextSha256 = C_inner 密文哈希（密封核验锚点：供应商下载后本地重算比对，确认密封未被调包）
      files.push({ role, assetId, downloadUrl: `/api/upload/files/${assetId}`, ciphertextSha256: asset.sha256 });
      const entry = envelope.files[role];
      if (entry?.kself) kselfByRole[role] = entry.kself;
    }

    // 归因锚点：首次取包时间（幂等——已有不重复写；§5.5 判定矩阵依赖「已持有 C_inner+K_self」事实）
    if (!submission.packageFetchedAt) {
      await this.prisma.supplierBidSubmission.updateMany({
        where: { supplierId, projectId, packageFetchedAt: null },
        data: { packageFetchedAt: new Date() },
      });
    }

    return {
      windowEnd: session.decryptWindowEnd,
      paused: !!session.pausedAt,
      files,
      kselfByRole,
      sealedFields: envelope.sealedFields, // 原样：cipher+kself（+fieldsSha256）——供应商 U盾解 DEK_F 揭示 F+nonce
    };
  }

  /**
   * 供应商解内层上传（dual-v2）：上传各角色解密明文 + F+nonce 承诺揭示。
   * 三段式同 bid.service.decryptSupplier：
   *   ① 请求形状门（claim 前 400：MISSING_FILES/INVALID_FIELDS/MISSING_NONCE——不占 RUNNING、无楔子）
   *   ② 原子抢占 PENDING→RUNNING（并发双击只成一笔；60s 崩溃接管）
   *   ③ 事务外内容级双闸（顺序短路：先逐文件 sha256 明文存证闸（含信封签名值交叉比对），后 fieldsCommit）
   *   ④ 短事务终局：明文资产（bid_decrypted）+ decryptedAssets/decryptedPrice + 开标记录预填 + 监督日志
   * 内容级闸失败 → DANGER+EXCEPTION+归因 UNKNOWN（密文损坏/错钥/篡改不可自动区分）；
   * 平台侧异常（文件引用缺失/记录缺失/存储失败）→ 归因 PLATFORM（§5.5）。
   * 上传明文只落 bid_decrypted 对象，绝不覆写 C_outer/C_inner。
   */
  async decryptUpload(
    supplierId: string,
    projectId: string,
    files: Partial<Record<EnvelopeRole, Buffer>>,
    fieldsJson: string,
    nonce: string,
  ) {
    // ── ① 门控（同 decryptSupplier/opening-package 口径）──
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId } });
    if (!bidSupplier) {
      throw new ForbiddenException({ error: '未参与该项目，无权解密上传', code: 'NOT_PROJECT_MEMBER' });
    }
    if (bidSupplier.decryptStatus === 'SUCCESS') {
      throw new BadRequestException({ error: '标书已解密成功，无需重复解密', code: 'ALREADY_DECRYPTED' });
    }
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法解密', code: 'PROJECT_NOT_OPENING' });
    }
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) {
      throw new BadRequestException({ error: '开标尚未启动，无法解密', code: 'OPENING_NOT_STARTED' });
    }
    if (session.pausedAt) {
      throw new BadRequestException({ error: '开标已暂停，解密操作暂时禁止', code: 'OPENING_PAUSED' });
    }
    const now = new Date();
    if (now < session.decryptWindowStart) {
      throw new BadRequestException({ error: '解密窗口尚未开启', code: 'DECRYPT_WINDOW_NOT_OPEN' });
    }
    if (now > session.decryptWindowEnd) {
      throw new BadRequestException({ error: '解密窗口已关闭', code: 'DECRYPT_WINDOW_CLOSED' });
    }

    // ── A-109a 签到 quorum 闸门（窗口校验后）：已签到且已递交不足法定家数 → 禁止进入解密 ──
    await assertDecryptCheckInQuorum(this.prisma, projectId);

    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    if (!submission || submission.status !== 'submitted') {
      throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });
    }
    if (submission.envelopeVersion !== 'dual-v2') {
      throw new BadRequestException({ error: '该供应商走旧轨（单层）加密，请走主持端解密通道', code: 'NOT_DUAL_TRACK' });
    }
    if (!submission.outerDecryptedAt || !submission.innerAssets) {
      throw new BadRequestException({ error: '外层尚未解密，无法进行内层解密上传', code: 'OUTER_NOT_DECRYPTED' });
    }
    const envelope = (submission.envelope ?? null) as DualEnvelope | null;
    if (!envelope?.files || !envelope.fieldsCommit) {
      throw new BadRequestException({ error: '信封缺失或承诺缺失，无法校验解密上传', code: 'ENVELOPE_MISSING' });
    }
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { userId: true } });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });

    // ── 请求形状门（claim 前 400，不占 RUNNING、无楔子——审查 fix round 1）──
    const innerEntries = (Object.entries(submission.innerAssets as Record<string, unknown>))
      .filter(([, assetId]) => !!assetId) as Array<[EnvelopeRole, string]>;
    if (innerEntries.length === 0) {
      // outerDecryptedAt 已置但归属链为空——平台侧异常，包未就绪（同 getOpeningPackage 口径）
      throw new BadRequestException({ error: '外层尚未解密，解密包未就绪', code: 'OUTER_NOT_DECRYPTED' });
    }
    const missingRoles = innerEntries
      .filter(([role]) => !files[role] || files[role]!.length === 0)
      .map(([role]) => role);
    if (missingRoles.length > 0) {
      throw new BadRequestException({ error: `缺少角色解密明文：${missingRoles.join('、')}`, code: 'MISSING_FILES' });
    }
    if (!nonce) {
      throw new BadRequestException({ error: '缺少 nonce（唱标字段承诺随机数）', code: 'MISSING_NONCE' });
    }
    let fields: SealedFields;
    try {
      const parsed = JSON.parse(fieldsJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad fields');
      fields = parsed as SealedFields;
    } catch {
      throw new BadRequestException({ error: '唱标字段承诺格式无效（fieldsJson 缺失或解析失败）', code: 'INVALID_FIELDS' });
    }

    // 原子抢占（PENDING→RUNNING；并发第二笔 count=0）
    const claim = await this.prisma.bidSupplier.updateMany({
      where: { id: bidSupplier.id, decryptStatus: 'PENDING' },
      data: { decryptStatus: 'RUNNING' },
    });
    if (claim.count === 0) {
      const fresh = await this.prisma.bidSupplier.findUnique({
        where: { id: bidSupplier.id },
        select: { decryptStatus: true, updatedAt: true },
      });
      if (fresh?.decryptStatus === 'SUCCESS') {
        throw new BadRequestException({ error: '标书已解密成功，无需重复解密', code: 'ALREADY_DECRYPTED' });
      }
      if (fresh?.decryptStatus === 'RUNNING') {
        // 崩溃接管：RUNNING 停滞超 60s（进程崩溃/外部 IO 卡死遗留）方可重占（同 decryptSupplier 口径）
        const takeover = await this.prisma.bidSupplier.updateMany({
          where: { id: bidSupplier.id, decryptStatus: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 60_000) } },
          data: { decryptStatus: 'RUNNING' },
        });
        if (takeover.count === 0) {
          throw new ConflictException({ error: '该供应商标书正在解密中，请勿重复提交', code: 'DECRYPT_ALREADY_IN_FLIGHT' });
        }
      } else {
        throw new ConflictException({
          error: fresh?.decryptStatus === 'DANGER'
            ? '该供应商标书已定性为解密异常，无需重复操作'
            : '该供应商标书正在解密中，请勿重复提交',
          code: 'DECRYPT_ALREADY_IN_FLIGHT',
        });
      }
    }

    // ── ② 事务外内容级双闸校验（claim 后；顺序短路：先逐文件明文存证闸（含信封交叉比对），后 fieldsCommit）──
    //    文件闸锚点 = 投递时原 FileAsset.sha256（明文存证哈希，== envelope.files[role].sha256，签名覆盖；
    //    补传同款闸门语义）。C_inner 资产（innerAssets）的 sha256 是密文哈希，不能做明文锚点。
    //    归因（§5.5，审查 fix round 1）：内容级失败（哈希/承诺不匹配——密文损坏/错钥/篡改不可区分）
    //    → UNKNOWN；平台侧异常（文件引用缺失/记录缺失/存储失败）→ PLATFORM。
    let gateError: string | null = null;
    let gateAttribution: 'UNKNOWN' | 'PLATFORM' = 'UNKNOWN';
    const uploaded: Array<{ role: EnvelopeRole; buf: Buffer }> = [];
    for (const [role] of innerEntries) {
      const buf = files[role]!;
      const refAssetId = (submission as any)[DUAL_ROLE_ASSET_KEY[role]] as string | null;
      if (!refAssetId) {
        gateError = `缺少 ${role} 原始文件引用，无法校验明文`;
        gateAttribution = 'PLATFORM';
        break;
      }
      const anchor = await this.prisma.fileAsset.findUnique({ where: { id: refAssetId } });
      if (!anchor?.sha256) {
        gateError = '原始文件记录缺失，无法校验明文';
        gateAttribution = 'PLATFORM';
        break;
      }
      // 纵深交叉比对（审查 fix round 1）：锚点须与签名覆盖的 envelope.files[role].sha256 一致——防锚点被替换
      const entry = envelope.files[role];
      if (!entry || entry.sha256 !== anchor.sha256) {
        gateError = '标书文件锚点与信封签名值交叉比对不符（疑似锚点被替换）';
        break; // UNKNOWN
      }
      if ((await sha256Hex(buf)) !== anchor.sha256) {
        gateError = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）';
        break; // UNKNOWN
      }
      uploaded.push({ role, buf });
    }
    if (!gateError && !(await this.dualEnvelope.verifyFieldsCommit(fields, nonce, envelope.fieldsCommit))) {
      gateError = '唱标字段承诺校验失败（fieldsCommit 不匹配，疑似篡改报价字段或重放 nonce）';
    }

    // 闸过才写 MinIO——明文只落 bid_decrypted 前缀，绝不覆写 C_outer/C_inner
    const objectKeyOf = (role: EnvelopeRole) => `bid-decrypted/${projectId}/${bidSupplier.id}/${role}.plain`;
    if (!gateError) {
      for (const { role, buf } of uploaded) {
        try {
          await minioClient.putObject(MINIO_BUCKET, objectKeyOf(role), buf, buf.length, {
            'Content-Type': 'application/octet-stream',
          });
        } catch (err) {
          this.logger.error(`decrypt-upload MinIO putObject failed: ${objectKeyOf(role)}`, (err as Error).stack);
          gateError = '文件存储失败，请重试';
          gateAttribution = 'PLATFORM';
          break;
        }
      }
    }

    // ── ③ 短事务终局写入（DB 状态+归属链+唱标预填+监督日志；WS 全部后置）──
    const outcome = gateError ? ('DANGER' as const) : ('SUCCESS' as const);
    let finalState: any = null;
    await this.prisma.$transaction(async (tx) => {
      if (outcome === 'DANGER') {
        await tx.bidSupplier.update({
          where: { id: bidSupplier.id },
          data: {
            decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION',
            decryptError: gateError!, dangerAttribution: gateAttribution,
          },
        });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName,
            action: '标书解密', result: `解密异常：${gateError}`, riskFlag: '高风险',
          },
        });
      } else {
        const decryptedAssets: Record<string, string> = {};
        for (const { role, buf } of uploaded) {
          // objectKey 确定性（project+bidSupplier+role）——DANGER 后「重置解密机会」重试会复用同 key：
          // upsert 而非裸 create，否则撞 key @unique（P2002）令终局事务整体回滚、供应商卡 RUNNING
          //（completeOpening 终审 Important #2 同款模式）
          const asset = await tx.fileAsset.upsert({
            where: { key: objectKeyOf(role) },
            create: {
              key: objectKeyOf(role),
              originalName: `${role}.plain`,
              mimeType: 'application/octet-stream',
              size: buf.length,
              sha256: await sha256Hex(buf), // 明文哈希（下载链路/审计锚点）
              category: 'bid_decrypted',
              clientEncrypted: false,
              encrypted: false,
              uploaderId: supplier.userId,
            },
            update: {
              size: buf.length,
              sha256: await sha256Hex(buf),
              uploaderId: supplier.userId,
            },
          });
          decryptedAssets[role] = asset.id;
        }
        await tx.supplierBidSubmission.update({
          where: { supplierId_projectId: { supplierId, projectId } },
          data: {
            decryptedAssets: decryptedAssets as unknown as Prisma.InputJsonValue,
            decryptedPrice: fields.price, // 已经 fieldsCommit 承诺验证（防开标时改价）
          },
        });
        // 唱标预填（旧轨 decryptSupplier 同款 recordData 形状——唱标表/供应商确认流无感衔接；
        // bondStatus 留空由主持人判定）
        const recordData = {
          supplierName: bidSupplier.supplierName,
          amount: fields.price,
          period: fields.deliveryPeriod,
          qualityTarget: fields.qualityCommitment,
          bondStatus: '',
          decryptResult: '解密成功',
          confirmStatus: '待供应商确认',
        };
        await tx.bidOpeningRecord.upsert({
          where: { projectId_bidSupplierId: { projectId, bidSupplierId: bidSupplier.id } },
          create: { projectId, ...recordData, bidSupplierId: bidSupplier.id },
          update: recordData,
        });
        await tx.bidSupplier.update({ where: { id: bidSupplier.id }, data: { decryptStatus: 'SUCCESS', decryptedAt: new Date() } });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName,
            action: '标书解密', result: '供应商解密成功，等待供应商确认唱标信息', riskFlag: '无',
          },
        });
      }
      finalState = await tx.bidSupplier.update({
        where: { id: bidSupplier.id },
        data: { confirmStatus: outcome === 'DANGER' ? 'EXCEPTION' : 'PENDING' },
      });
    });

    // WS 事件事务提交后发射（失败不回滚假通知，同 decryptSupplier 模式）
    if (outcome === 'DANGER') {
      this.gateway?.notifyDecryptStatus(projectId, bidSupplier.id, bidSupplier.supplierName, 'DANGER');
      this.gateway?.notifySupervisionLog(projectId, {
        role: '系统', action: '标书解密', target: bidSupplier.supplierName,
        result: `解密异常：${gateError}`, riskFlag: '高风险',
      });
      this.gateway?.notifyAnomaly(projectId, {
        type: 'decrypt_failure', supplierId: bidSupplier.id, supplierName: bidSupplier.supplierName,
        detail: gateError!, severity: 'danger',
      });
      // T15/T13 硬前置：失败站内信通知供应商本人（重试/联系主持人路径，fire-and-forget）
      this.notifySupplierDecryptFailure(bidSupplier.supplierId, bidSupplier.supplierName, projectId, gateError!);
    } else {
      this.gateway?.notifyDecryptStatus(projectId, bidSupplier.id, bidSupplier.supplierName, 'SUCCESS');
      this.gateway?.notifySupervisionLog(projectId, {
        role: '系统', action: '标书解密', target: bidSupplier.supplierName,
        result: '供应商解密成功，等待供应商确认唱标信息', riskFlag: '无',
      });
    }
    // 终局即固化（A）：解密异常(DANGER)即终局态——全体终局则自动固化开标文件包（幂等、不阻塞解密响应）
    void this.bidService.autoHandoverIfDone(projectId, '供应商解密终局');
    return finalState;
  }

  /**
   * 解密失败站内信（T15 硬前置，fire-and-forget，不阻塞解密主流程）：
   * decrypt-upload 落 DANGER 后通知供应商本人——重试/联系主持人路径（与 bid.service 同款口径）。
   */
  private async notifySupplierDecryptFailure(
    supplierId: string | null,
    supplierName: string,
    projectId: string,
    reason: string,
  ) {
    if (!supplierId) return;
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { userId: true },
      });
      if (supplier?.userId) {
        await this.notificationService.sendToUser(supplier.userId, ['in_app'], {
          type: 'BID_DECRYPT_FAILED',
          title: `投标文件解密异常：${supplierName}`,
          content: `您在项目中的投标文件解密失败：${reason}。请联系开标主持人处理或等待重新解密。`,
          link: `/supplier/bid/${projectId}`,
        });
      }
    } catch {
      /* 通知失败不阻塞解密流程 */
    }
  }

  /**
   * 已完成项目：该供应商参与（曾进入候选名单）且项目已完结（ARCHIVED 归档 / ABORTED 流标）的
   * 合作历史。含本人投递状态与中标结果（ProcurementRound.awardedSupplierId 命中即中标）。
   */
  async listCompletedProjects(supplierId: string) {
    const rows = await this.prisma.bidSupplier.findMany({
      where: {
        supplierId,
        project: { stage: { in: ['ARCHIVED', 'ABORTED'] } },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        project: {
          select: {
            id: true, projectCode: true, name: true, procurementMethod: true,
            stage: true, deadline: true, openTime: true, updatedAt: true,
          },
        },
      },
    });

    // 本人中标轮次（awardAmount / 轮次号）
    const rounds = await this.prisma.procurementRound.findMany({
      where: { awardedSupplierId: supplierId },
      select: { projectId: true, awardAmount: true, roundNo: true },
    });
    const awardMap = new Map<string, { awardAmount: any; roundNo: number }>();
    for (const r of rounds) awardMap.set(r.projectId, { awardAmount: r.awardAmount, roundNo: r.roundNo });

    // 本人有效投递（submitted 状态）
    const subs = await this.prisma.supplierBidSubmission.findMany({
      where: { supplierId, projectId: { in: rows.map((r) => r.projectId) }, status: 'submitted' },
      select: { projectId: true, bidPrice: true, submittedAt: true },
    });
    const subMap = new Map(subs.map((x) => [x.projectId, x]));

    return rows.map((r) => {
      const award = awardMap.get(r.projectId);
      const sub = subMap.get(r.projectId);
      const myPrice = sub?.bidPrice ? openField(sub.bidPrice, process.env.KMS_SECRET!) : null;
      return {
        projectId: r.projectId,
        projectCode: r.project.projectCode,
        name: r.project.name,
        procurementMethod: r.project.procurementMethod,
        stage: r.project.stage, // ARCHIVED / ABORTED
        completedAt: r.project.updatedAt,
        // 我的结果：中标（含金额/轮次）/ 已投递未中标 / 未投递
        outcome: award
          ? 'AWARDED'
          : r.project.stage === 'ABORTED'
            ? 'ABORTED'
            : sub ? 'PARTICIPATED' : 'INVITED',
        awardAmount: award?.awardAmount ?? null,
        awardRoundNo: award?.roundNo ?? null,
        myBidPrice: myPrice,
        submittedAt: sub?.submittedAt ?? null,
        submitStatus: r.submitStatus,
      };
    });
  }

  async getMySubmissions(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });
    const submissions = await this.prisma.supplierBidSubmission.findMany({
      where: { supplierId, status: { not: 'draft' } },
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: {
            id: true, projectCode: true, projectManagementItemId: true, name: true,
            procurementMethod: true, stage: true, deadline: true, openTime: true,
          },
        },
      },
    });
    // 富化 BidSupplier.confirmStatus，供前端判断是否已确认开标
    if (submissions.length > 0 && supplier) {
      const projectIds = submissions.map(s => s.projectId);
      const bidSuppliers = await this.prisma.bidSupplier.findMany({
        where: {
          projectId: { in: projectIds },
          supplierName: supplier.name,
        },
        select: { projectId: true, confirmStatus: true },
      });
      const confirmMap: Record<string, string> = {};
      for (const bs of bidSuppliers) confirmMap[bs.projectId] = bs.confirmStatus;
      for (const s of submissions) {
        (s as any).confirmStatus = confirmMap[s.projectId] || null;
        // P2：本人报价回显解封（bidPrice 入库密封防采购侧窥视；供应商看自己的报价是明文权利）
        if (s.bidPrice) (s as any).bidPrice = openField(s.bidPrice, process.env.KMS_SECRET!) ?? s.bidPrice;
      }
    }
    // 展示编号统一为项目管理业务编号（与可投标项目列表一致）
    return Promise.all(submissions.map(async s => ({
      ...s,
      project: await this.resolveDisplayCode(s.project),
    })));
  }

  async getSubmission(supplierId: string, projectId: string) {
    const sub = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    // P0-1：前端 BidSubmit.vue 按 fullBidFileAssetId/coverLetterFileAssetId 回读草稿——回传别名避免回显丢文件。
    if (sub) {
      (sub as any).fullBidFileAssetId = sub.technicalFileAssetId;
      (sub as any).coverLetterFileAssetId = sub.coverLetterAssetId;
      // P2：本人报价回显解封（回读草稿时报价可编辑的前提）
      if (sub.bidPrice) (sub as any).bidPrice = openField(sub.bidPrice, process.env.KMS_SECRET!) ?? sub.bidPrice;
    }
    if (!sub) return null;
    // A-101：回执编号 TB-yyyymmdd-NNN 存于 BidSupplier（名册级，投递时生成/继承），SupplierBidSubmission 无此列——
    // 并入返回供供应商端回执卡展示；仅增字段，既有消费方（submit 页回读草稿别名/解封报价）不受影响。
    const bid = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
      select: { receiptNo: true },
    });
    return { ...sub, receiptNo: bid?.receiptNo ?? null };
  }

  async withdrawSubmission(supplierId: string, submissionId: string) {
    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission || submission.supplierId !== supplierId) {
      throw new BadRequestException({ error: '标书不存在', code: 'NOT_FOUND' });
    }
    if (submission.status !== 'submitted') {
      throw new BadRequestException({ error: '只能撤回已提交的标书', code: 'INVALID_STATUS' });
    }

    const project = await this.prisma.bidProject.findUnique({
      where: { id: submission.projectId },
      select: { stage: true, name: true, deadline: true },
    });
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '项目已进入开标或后续阶段，无法撤回', code: 'PROJECT_ALREADY_OPENING' });
    }
    // P1-2：截标后（:3005 尚未按时开标、stage 仍 SUBMIT 的窗口期）依法不得撤回
    // （《招标投标法实施条例》第 35 条：撤回投标文件应当在投标截止时间前）。
    if (project.deadline && project.deadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '投标截止时间已过，依法不得撤回标书', code: 'DEADLINE_PASSED' });
    }

    // 收集密封文件路径供事务后异步清理
    const assetIds = [submission.technicalFileAssetId, submission.businessFileAssetId, submission.coverLetterAssetId].filter(Boolean) as string[];

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.supplierBidSubmission.update({
        where: { id: submissionId },
        data: { status: 'withdrawn' },
      });

      await tx.bidSupplier.updateMany({
        where: { projectId: submission.projectId, supplierId },
        data: { submitStatus: '已撤回', encryptStatus: '已撤回' },
      });

      await tx.bidSupervisionLog.create({
        data: {
          projectId: submission.projectId,
          time: new Date(),
          role: '供应商',
          target: supplierId,
          action: '撤回投标',
          // P1-2：按事实措辞（此前恒写「截止前」；截止后撤回已被上方闸门拦截，此路径必为截止前）
          result: '供应商在投递截止前撤回标书',
          riskFlag: '无',
        },
      });

      return result;
    });

    // 事务后异步清理 MinIO 密封文件（best-effort，不阻塞）
    if (assetIds.length > 0) {
      const assets = await this.prisma.fileAsset.findMany({
        where: { id: { in: assetIds } },
        select: { sealedPath: true },
      }).catch(() => [] as { sealedPath: string | null }[]);
      for (const a of assets) {
        if (a.sealedPath) {
          try { await minioClient.removeObject(MINIO_BUCKET, a.sealedPath); } catch (_) { /* best-effort */ }
        }
      }
    }

    return updated;
  }

  // ─── 开标确认（供应商侧）───

  /**
   * 供应商本司开标记录 + 本人投递原值对比（唱标内容与投递一致性核对）。
   * submitted.bidPrice 为解封后的投递报价（仅本人可见）；mismatch 标志口径与主持端
   * 唱标录入校验同源（opening-compare.util.ts 单一来源）。
   * 未唱标时仅返回 submitted（本司投递原值，不暴露任何他人数据）。
   */
  async getMyOpeningRecord(supplierId: string, projectId: string) {
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { supplierId, projectId } });
    if (!bidSupplier) return null;
    const [record, submission] = await Promise.all([
      this.prisma.bidOpeningRecord.findFirst({ where: { projectId, bidSupplierId: bidSupplier.id } }),
      this.prisma.supplierBidSubmission.findUnique({
        where: { supplierId_projectId: { supplierId, projectId } },
        select: { bidPrice: true, deliveryPeriod: true, qualityCommitment: true },
      }),
    ]);
    const submittedBidPrice = submission?.bidPrice ? openField(submission.bidPrice, process.env.KMS_SECRET!) : null;
    // 投递报价显示归一为元（与唱标总表「报价（元）」单位统一；P1-13 投递表单万元/元口径）。
    // 未唱标无锚点 → null，前端回落显示原值 + 投递表单单位。
    const submittedBidPriceInYuan = resolveDisplayInYuan(submittedBidPrice, record?.amount ?? undefined);
    return {
      ...(record ?? {}),
      submitted: submission
        ? {
            bidPrice: submittedBidPrice,
            bidPriceInYuan: submittedBidPriceInYuan,
            deliveryPeriod: submission.deliveryPeriod ?? null,
            qualityCommitment: submission.qualityCommitment ?? null,
            priceMismatch: record?.amount != null
              && isPriceMismatch(submittedBidPriceInYuan, record.amount),
            periodMismatch: isPeriodMismatch(submission.deliveryPeriod, record?.period),
          }
        : null,
    };
  }

  /**
   * 唱标记录列表（大厅公开视图，供应商侧）：
   * 自 OPENING 阶段起向本项目全体投标人公开各家唱标信息
   * （《电子招标投标办法》第30条：解密完成后向所有投标人公布名称/价格等唱标内容）。
   * 脱敏：异议原因/处理结果/操作人留痕（objectionReason/handleResult/handledBy/handledAt）
   * 属主持端裁决过程信息，不下发；confirmStatus 为大厅公开状态，保留。
   * 成员门控与 WS join:project 对齐（bid.gateway.ts）——非本项目投标人不得查看。
   */
  async listOpeningRecords(supplierId: string, projectId: string) {
    const member = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({ error: '仅本项目投标人可查看开标记录', code: 'NOT_PROJECT_MEMBER' });
    }
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!['OPENING', 'EVALUATING', 'ARCHIVED'].includes(project.stage)) {
      throw new BadRequestException({ error: '开标尚未开始，唱标记录暂不可见', code: 'OPENING_NOT_STARTED' });
    }
    return this.prisma.bidOpeningRecord.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        bidSupplierId: true,
        supplierName: true,
        amount: true,
        period: true,
        qualityTarget: true,
        bondStatus: true,
        decryptResult: true,
        confirmStatus: true,
        confirmedAt: true,
      },
    });
  }

  /* ── A-114：开标记录确认 SM2 电子签名（canonical/验签/归档，范式同回执签名通道）── */

  /** 待确认态集合（「待确认」为旧值，种子/历史数据与「待供应商确认」同义）。 */
  private static readonly OPENING_PENDING_CONFIRM = ['待供应商确认', '待确认'];

  /**
   * 私有：确认/补签共用上下文——阶段门（OPENING）+ 本人投标记录（解密 SUCCESS）+
   * 本司开标记录 + 供应商 SM2 公钥（未绑盾 400）。记录不存在 → 400 RECORD_NOT_CONFIRMABLE
   * （与既有确认状态门同码，维持 API 兼容）。
   */
  private async loadOpeningConfirmContext(supplierId: string, projectId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法确认', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { supplierId, projectId } });
    if (!bidSupplier) throw new BadRequestException({ error: '投标记录不存在', code: 'BID_SUPPLIER_NOT_FOUND' });
    if (bidSupplier.decryptStatus !== 'SUCCESS') {
      throw new BadRequestException({ error: '标书尚未解密成功', code: 'NOT_DECRYPTED' });
    }

    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { projectId, bidSupplierId: bidSupplier.id } });
    if (!record) {
      throw new BadRequestException({ error: '当前开标记录不可确认（仅待供应商确认状态可操作）', code: 'RECORD_NOT_CONFIRMABLE' });
    }

    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { sm2PublicKey: true } });
    if (!supplier?.sm2PublicKey) {
      throw new BadRequestException({ error: '供应商未绑定 SM2 公钥（U盾证书），无法签署开标确认', code: 'SM2_PUBLIC_KEY_MISSING' });
    }
    return { project, bidSupplier, record, sm2PublicKey: supplier.sm2PublicKey };
  }

  /**
   * 取开标确认待签负载（A-114）：服务端以 DB 为准重建 canonical，不信任客户端传入。
   * 可用条件 = 记录待确认（purpose=confirm，首次确认签名）或已确认且未签名（purpose=resign，补签）。
   */
  async getOpeningConfirmPayload(supplierId: string, projectId: string) {
    const { bidSupplier, record } = await this.loadOpeningConfirmContext(supplierId, projectId);
    let purpose: 'confirm' | 'resign';
    if (SupplierPortalService.OPENING_PENDING_CONFIRM.includes(record.confirmStatus)) {
      purpose = 'confirm';
    } else if (record.confirmStatus === '供应商已确认' && !record.confirmSignature) {
      purpose = 'resign';
    } else {
      throw new BadRequestException({ error: '当前开标记录不可确认（仅待供应商确认状态可操作）', code: 'RECORD_NOT_CONFIRMABLE' });
    }
    const canonical = buildOpeningConfirmCanonical({
      purpose, projectId, supplierId,
      bidSupplierId: bidSupplier.id, recordId: record.id,
      supplierName: record.supplierName,
      amount: record.amount, period: record.period, qualityTarget: record.qualityTarget,
      bondStatus: record.bondStatus, decryptResult: record.decryptResult,
    });
    return { payload: JSON.parse(canonical), canonical };
  }

  /**
   * 确认/补签开标记录（单端点双语义，A-114）：
   * - confirm（待确认态）：原确认事务（记录态+confirmedAt+bidSupplier CONFIRMED+监督日志）+ 追加
   *   签名归档；WS notifyOpeningConfirmed 与 autoHandoverIfDone 保留。
   * - resign（已确认未签名）：不进状态机——仅回填签名证据+监督日志；无 WS、无 autoHandover；幂等。
   * 两分支验签前置（服务端重算 canonical → SM2/SM3），失败 400 OPENING_CONFIRM_SIGNATURE_INVALID。
   * Wave 5-1 状态门不变：仅待确认态可确认（异议已处理-退回/已异议态不得翻回确认）。
   */
  async confirmOpening(supplierId: string, projectId: string, signature: string) {
    const { bidSupplier, record, sm2PublicKey } = await this.loadOpeningConfirmContext(supplierId, projectId);
    let purpose: 'confirm' | 'resign';
    if (SupplierPortalService.OPENING_PENDING_CONFIRM.includes(record.confirmStatus)) {
      purpose = 'confirm';
    } else if (record.confirmStatus === '供应商已确认') {
      purpose = 'resign';
    } else {
      // 状态门（Wave 5-1，与 host 侧 R7 状态机对称；UI 已门控，此为 API 防线）
      throw new BadRequestException({ error: '当前开标记录不可确认（仅待供应商确认状态可操作）', code: 'RECORD_NOT_CONFIRMABLE' });
    }

    // 补签幂等：已签名直接返回（不再验签/写库）
    if (purpose === 'resign' && record.confirmSignature) {
      return { success: true, alreadySigned: true };
    }

    const canonical = buildOpeningConfirmCanonical({
      purpose, projectId, supplierId,
      bidSupplierId: bidSupplier.id, recordId: record.id,
      supplierName: record.supplierName,
      amount: record.amount, period: record.period, qualityTarget: record.qualityTarget,
      bondStatus: record.bondStatus, decryptResult: record.decryptResult,
    });
    if (!this.signatureService.verify(canonical, signature, sm2PublicKey)) {
      throw new BadRequestException({ error: '开标确认电子签名验证失败（SM2）', code: 'OPENING_CONFIRM_SIGNATURE_INVALID' });
    }
    const confirmSignature = { payload: JSON.parse(canonical), signature, algorithm: 'SM2/SM3', verifiedAt: new Date().toISOString() };

    if (purpose === 'confirm') {
      await this.prisma.$transaction(async (tx) => {
        await tx.bidOpeningRecord.updateMany({
          where: { projectId, bidSupplierId: bidSupplier.id },
          data: {
            confirmStatus: '供应商已确认', confirmedAt: new Date(),
            confirmSignature, confirmSignedAt: new Date(),
          },
        });
        await tx.bidSupplier.update({ where: { id: bidSupplier.id }, data: { confirmStatus: 'CONFIRMED' } });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '供应商', target: bidSupplier.supplierName,
            action: '确认唱标信息（电子签名）', result: '供应商确认开标记录无误', riskFlag: '无',
          },
        });
      });
      this.gateway?.notifyOpeningConfirmed(projectId, supplierId, {
        projectId, supplierId, supplierName: bidSupplier.supplierName, timestamp: Date.now(),
      });
      // 终局即固化（A）：确认唱标是最后一类终局写入——全体终局则自动固化开标文件包（幂等、不阻塞确认响应）
      void this.bidService.autoHandoverIfDone(projectId, '供应商确认唱标');
      return { success: true };
    }

    // 补签：唯一键（projectId+bidSupplierId）定点回填，不改任何状态字段（confirmStatus/confirmedAt/bidSupplier 均不动）
    await this.prisma.bidOpeningRecord.update({
      where: { projectId_bidSupplierId: { projectId, bidSupplierId: bidSupplier.id } },
      data: { confirmSignature, confirmSignedAt: new Date() },
    });
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '供应商', target: bidSupplier.supplierName,
        action: '补签开标确认电子签名', result: '已确认开标记录补签 SM2/SM3 电子签名', riskFlag: '低风险',
      },
    });
    return { success: true, alreadySigned: false };
  }

  async disputeOpening(supplierId: string, projectId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException({ error: '请填写异议原因', code: 'MISSING_REASON' });
    }

    // P0: 阶段门控 — 仅在开标阶段可提出异议
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法提出异议', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { supplierId, projectId } });
    if (!bidSupplier) throw new BadRequestException({ error: '投标记录不存在', code: 'BID_SUPPLIER_NOT_FOUND' });

    // Wave 5-1：状态门——仅待确认态的记录可异议（与 host 侧 R7 状态机对称；UI 已门控，此为 API 防线）。
    // 异议处理退回后记录态为「异议已处理-退回」——供应商不可再异议（R7 闭环；如需再异议走线下/
    // 书面渠道），已确认/已处理态同样不可翻回异议态。「待确认」为旧值，与「待供应商确认」同义。
    const PENDING_CONFIRM = ['待供应商确认', '待确认'];
    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { projectId, bidSupplierId: bidSupplier.id } });
    if (!record || !PENDING_CONFIRM.includes(record.confirmStatus)) {
      throw new BadRequestException({ error: '当前开标记录不可异议（仅待供应商确认状态可操作）', code: 'RECORD_NOT_DISPUTABLE' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bidOpeningRecord.updateMany({
        where: { projectId, bidSupplierId: bidSupplier.id },
        data: { confirmStatus: '供应商提出异议', objectionReason: reason },
      });
      await tx.bidSupplier.update({ where: { id: bidSupplier.id }, data: { confirmStatus: 'DISPUTED' } });
      // 首笔异议记录 disputedSince（供超时检测）
      const session = await tx.bidOpeningSession.findUnique({ where: { projectId }, select: { disputedSince: true } });
      if (!session?.disputedSince) {
        await tx.bidOpeningSession.update({ where: { projectId }, data: { disputedSince: new Date() } });
      }
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '供应商', target: bidSupplier.supplierName,
          action: '提出开标异议', result: reason, riskFlag: '中风险',
        },
      });
    });
    this.gateway?.notifyOpeningDisputed(projectId, supplierId, {
      projectId, supplierId, supplierName: bidSupplier.supplierName, reason, timestamp: Date.now(),
    });
    return { success: true };
  }

  // ─── 集中采购目录（脱敏浏览：只暴露品类/规格/单位，绝不暴露价格）───

  /** 脱敏视图：剥离所有价格字段，附加供应商数量。 */
  private toCatalogPublicView(item: any, supplierCount = 0) {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      specification: item.specification,
      category: item.category,
      group: item.group,
      unit: item.unit,
      region: item.region,
      status: item.status,
      supplierCount, // 仅数量，不含供应商名称/价格
    };
  }

  async listCatalogCategories() {
    const rows = await this.prisma.catalogItem.findMany({
      select: { group: true, category: true },
      distinct: ['group', 'category'],
      orderBy: [{ group: 'asc' }, { category: 'asc' }],
    });
    // Count items per group
    const groupCounts = await this.prisma.catalogItem.groupBy({
      by: ['group'],
      _count: { _all: true },
    });
    const countMap = new Map(groupCounts.map(g => [g.group, g._count._all]));
    const map = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.group) continue;
      if (!map.has(r.group)) map.set(r.group, []);
      if (r.category && !map.get(r.group)!.includes(r.category)) {
        map.get(r.group)!.push(r.category);
      }
    }
    return Array.from(map.entries()).map(([group, categories]) => ({
      group,
      categories,
      itemCount: countMap.get(group) ?? 0,
    }));
  }

  async listCatalogItems(params: { category?: string; group?: string; search?: string }) {
    const where: any = {};
    if (params.group && params.group !== '全部') where.group = params.group;
    if (params.category && params.category !== '全部') where.category = params.category;
    if (params.search?.trim()) {
      const kw = params.search.trim();
      where.OR = [
        { code: { contains: kw, mode: 'insensitive' } },
        { name: { contains: kw, mode: 'insensitive' } },
        { specification: { contains: kw, mode: 'insensitive' } },
      ];
    }
    const items = await this.prisma.catalogItem.findMany({ where, orderBy: { code: 'asc' } });
    if (items.length === 0) return [];
    const counts = await this.prisma.catalogSupplier.groupBy({
      by: ['catalogItemId'],
      where: { catalogItemId: { in: items.map(i => i.id) }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map(c => [c.catalogItemId, c._count._all]));
    return items.map(i => this.toCatalogPublicView(i, countMap.get(i.id) ?? 0));
  }

  async getCatalogItem(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new BadRequestException({ error: '目录条目不存在', code: 'NOT_FOUND' });
    const supplierCount = await this.prisma.catalogSupplier.count({
      where: { catalogItemId: id, status: 'ACTIVE' },
    });
    return this.toCatalogPublicView(item, supplierCount);
  }

  /** 我对某个品类的供货/申请状态（供前端按钮置灰用）。 */
  async getCatalogItemSupplyStatus(supplierId: string, itemId: string) {
    const [active, inProgress] = await Promise.all([
      this.prisma.catalogSupplier.findUnique({
        where: { catalogItemId_supplierId: { catalogItemId: itemId, supplierId } },
        select: { id: true, status: true, quotedPrice: true },
      }),
      this.prisma.supplierCatalogApplication.findFirst({
        where: {
          supplierId,
          catalogItemId: itemId,
          status: { in: ['PENDING', 'COUNTERED', 'RETURNED'] },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, type: true, status: true },
      }),
    ]);
    return {
      hasActiveSupply: !!active && active.status === 'ACTIVE',
      activeSupplyId: active?.id ?? null,
      inProgressApplication: inProgress,
      canApplyJoin: !active && !inProgress,
      canUpdateQuote: !!active && active.status === 'ACTIVE' && !inProgress,
    };
  }

  // ─── 目录供货申请（新增品类 / 加入供货 / 改报价，含议价）───

  async listMyCatalogApplications(supplierId: string) {
    const apps = await this.prisma.supplierCatalogApplication.findMany({
      where: { supplierId },
      orderBy: { updatedAt: 'desc' },
      include: {
        catalogItem: {
          select: { id: true, code: true, name: true, specification: true, category: true, group: true, unit: true },
        },
      },
    });
    return apps.map(a => ({
      ...a,
      quotedPrice: a.quotedPrice != null ? Number(a.quotedPrice) : null,
      counterPrice: a.counterPrice != null ? Number(a.counterPrice) : null,
    }));
  }

  async createCatalogApplication(supplierId: string, input: {
    type: string;
    catalogItemId?: string;
    proposedName?: string;
    proposedSpec?: string;
    proposedCategory?: string;
    proposedGroup?: string;
    proposedUnit?: string;
    quotedPrice?: string | number;
    deliveryPeriod?: string;
    region?: string;
    minOrder?: string;
    taxIncluded?: boolean;
    freightIncluded?: boolean;
    qualificationNote?: string;
    attachmentFileAssetId?: string;
  }) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可提交供货申请', code: 'NOT_APPROVED' });
    }

    const type = input.type;
    if (!['NEW_ITEM', 'JOIN_EXISTING', 'UPDATE_QUOTE'].includes(type)) {
      throw new BadRequestException({ error: '申请类型无效', code: 'INVALID_TYPE' });
    }
    if (input.quotedPrice == null || Number(input.quotedPrice) <= 0) {
      throw new BadRequestException({ error: '请填写有效报价', code: 'MISSING_QUOTE' });
    }

    // —— 类型相关校验 + 防重复（decision #5）——
    if (type === 'NEW_ITEM') {
      if (!input.proposedName?.trim() || !input.proposedCategory?.trim() || !input.proposedGroup?.trim() || !input.proposedUnit?.trim()) {
        throw new BadRequestException({ error: '新增品类需填写物资名称/分类/组别/单位', code: 'MISSING_PROPOSED_FIELDS' });
      }
      const dup = await this.prisma.supplierCatalogApplication.findFirst({
        where: {
          supplierId,
          type: 'NEW_ITEM',
          status: { in: ['PENDING', 'COUNTERED', 'RETURNED'] },
          proposedName: input.proposedName.trim(),
        },
      });
      if (dup) throw new BadRequestException({ error: '该物资已有进行中的新增申请', code: 'DUPLICATE_APPLICATION' });
    } else {
      // JOIN_EXISTING / UPDATE_QUOTE 必须指向已有目录条目
      if (!input.catalogItemId) {
        throw new BadRequestException({ error: '请选择目标目录条目', code: 'MISSING_CATALOG_ITEM' });
      }
      const item = await this.prisma.catalogItem.findUnique({ where: { id: input.catalogItemId } });
      if (!item) throw new BadRequestException({ error: '目录条目不存在', code: 'CATALOG_ITEM_NOT_FOUND' });

      const active = await this.prisma.catalogSupplier.findUnique({
        where: { catalogItemId_supplierId: { catalogItemId: input.catalogItemId, supplierId } },
      });
      const inProgress = await this.prisma.supplierCatalogApplication.findFirst({
        where: {
          supplierId, catalogItemId: input.catalogItemId,
          status: { in: ['PENDING', 'COUNTERED', 'RETURNED'] },
        },
      });

      if (type === 'JOIN_EXISTING') {
        if (active) throw new BadRequestException({ error: '您已是该品类的准入供应商，如需改价请提交改报价申请', code: 'ALREADY_SUPPLYING' });
        if (inProgress) throw new BadRequestException({ error: '该品类已有进行中的申请', code: 'DUPLICATE_APPLICATION' });
      } else {
        // UPDATE_QUOTE：必须已有 ACTIVE 关系
        if (!active || active.status !== 'ACTIVE') {
          throw new BadRequestException({ error: '仅已准入的供应商可申请改报价', code: 'NO_ACTIVE_SUPPLY' });
        }
        if (inProgress && inProgress.type === 'UPDATE_QUOTE') {
          throw new BadRequestException({ error: '该品类已有进行中的改报价申请', code: 'DUPLICATE_APPLICATION' });
        }
      }
    }

    return this.prisma.supplierCatalogApplication.create({
      data: {
        supplierId,
        type,
        catalogItemId: type === 'NEW_ITEM' ? null : input.catalogItemId,
        proposedName: type === 'NEW_ITEM' ? input.proposedName!.trim() : null,
        proposedSpec: type === 'NEW_ITEM' ? input.proposedSpec?.trim() ?? null : null,
        proposedCategory: type === 'NEW_ITEM' ? input.proposedCategory!.trim() : null,
        proposedGroup: type === 'NEW_ITEM' ? input.proposedGroup!.trim() : null,
        proposedUnit: type === 'NEW_ITEM' ? input.proposedUnit!.trim() : null,
        quotedPrice: Number(input.quotedPrice),
        deliveryPeriod: input.deliveryPeriod?.trim() || null,
        region: input.region?.trim() || null,
        minOrder: input.minOrder?.trim() || null,
        taxIncluded: input.taxIncluded ?? true,
        freightIncluded: input.freightIncluded ?? false,
        qualificationNote: input.qualificationNote?.trim() || null,
        attachmentFileAssetId: input.attachmentFileAssetId || null,
        status: 'PENDING',
      },
    });
  }

  /** 供应商编辑并重新提交（RETURNED 补正 / COUNTERED 再报价）。→ PENDING */
  async updateMyCatalogApplication(
    supplierId: string,
    userId: string,
    applicationId: string,
    input: Partial<{
      proposedName: string; proposedSpec: string; proposedCategory: string;
      proposedGroup: string; proposedUnit: string;
      quotedPrice: string | number; deliveryPeriod: string; region: string;
      minOrder: string; taxIncluded: boolean; freightIncluded: boolean;
      qualificationNote: string; attachmentFileAssetId: string;
    }>,
  ) {
    const app = await this.prisma.supplierCatalogApplication.findUnique({ where: { id: applicationId } });
    if (!app || app.supplierId !== supplierId) {
      throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
    }
    if (!['RETURNED', 'COUNTERED'].includes(app.status)) {
      throw new BadRequestException({ error: '当前状态不可编辑，仅退回/议价中的申请可重新提交', code: 'INVALID_STATUS' });
    }
    const data: any = { status: 'PENDING', reviewerNote: null };
    if (input.quotedPrice != null && Number(input.quotedPrice) > 0) data.quotedPrice = Number(input.quotedPrice);
    if (input.proposedName != null) data.proposedName = input.proposedName.trim();
    if (input.proposedSpec != null) data.proposedSpec = input.proposedSpec.trim();
    if (input.proposedCategory != null) data.proposedCategory = input.proposedCategory.trim();
    if (input.proposedGroup != null) data.proposedGroup = input.proposedGroup.trim();
    if (input.proposedUnit != null) data.proposedUnit = input.proposedUnit.trim();
    if (input.deliveryPeriod != null) data.deliveryPeriod = input.deliveryPeriod.trim() || null;
    if (input.region != null) data.region = input.region.trim() || null;
    if (input.minOrder != null) data.minOrder = input.minOrder.trim() || null;
    if (input.taxIncluded != null) data.taxIncluded = input.taxIncluded;
    if (input.freightIncluded != null) data.freightIncluded = input.freightIncluded;
    if (input.qualificationNote != null) data.qualificationNote = input.qualificationNote.trim() || null;
    if (input.attachmentFileAssetId != null) data.attachmentFileAssetId = input.attachmentFileAssetId || null;
    const updated = await this.prisma.supplierCatalogApplication.update({ where: { id: applicationId }, data });
    await this.notifyReviewer(app, '供货申请已重新提交', `供应商已重新提交申请并改价至 ¥${Number(updated.quotedPrice)}，请审核。`);
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_APPLICATION_RESUBMITTED', resourceType: '目录供货申请', details: { applicationId, status: app.status } } });
    return updated;
  }

  /** 供应商接受议价反报价。COUNTERED → PENDING（quotedPrice 落为 counterPrice，待管理员最终通过）。 */
  async acceptCatalogCounter(supplierId: string, userId: string, applicationId: string) {
    const app = await this.prisma.supplierCatalogApplication.findUnique({ where: { id: applicationId } });
    if (!app || app.supplierId !== supplierId) {
      throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
    }
    if (app.status !== 'COUNTERED' || app.counterPrice == null) {
      throw new BadRequestException({ error: '该申请不在议价状态', code: 'INVALID_STATUS' });
    }
    const updated = await this.prisma.supplierCatalogApplication.update({
      where: { id: applicationId },
      data: { quotedPrice: Number(app.counterPrice), status: 'PENDING' },
    });
    await this.notifyReviewer(app, '供应商已接受议价', `供应商已接受反报价 ¥${Number(app.counterPrice)}，请进行最终审核。`);
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_COUNTER_ACCEPTED', resourceType: '目录供货申请', details: { applicationId, counterPrice: Number(app.counterPrice) } } });
    return updated;
  }

  /** 供应商撤回申请。任意非终态 → WITHDRAWN。 */
  async withdrawCatalogApplication(supplierId: string, userId: string, applicationId: string) {
    const app = await this.prisma.supplierCatalogApplication.findUnique({ where: { id: applicationId } });
    if (!app || app.supplierId !== supplierId) {
      throw new BadRequestException({ error: '申请不存在', code: 'NOT_FOUND' });
    }
    if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(app.status)) {
      throw new BadRequestException({ error: '该申请已结束，不可撤回', code: 'INVALID_STATUS' });
    }
    const updated = await this.prisma.supplierCatalogApplication.update({
      where: { id: applicationId },
      data: { status: 'WITHDRAWN' },
    });
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_APPLICATION_WITHDRAWN', resourceType: '目录供货申请', details: { applicationId } } });
    return updated;
  }

  /** 通知审核管理员（议价/退回的发起人）。若无 reviewedBy 则静默跳过。 */
  private async notifyReviewer(app: any, title: string, content: string) {
    if (!app.reviewedBy) return;
    // 深链到 :3005 目录审批 Tab 并定位到该申请（与 reviewApplication 后的 resolve link 全等，待办可清零）。
    // 旧 link /supplier/catalog-review 在 :3005 不存在（死链）。
    const link = `/mall-management/catalog?tab=approval&appId=${app.id}`;
    await this.prisma.notification.create({ data: { userId: app.reviewedBy, type: 'CATALOG_APPLICATION', title, content, link } });
  }

  // ─── 我的已准入供货关系 ───

  async listMyCatalogSupply(supplierId: string) {
    const rows = await this.prisma.catalogSupplier.findMany({
      where: { supplierId },
      orderBy: { updatedAt: 'desc' },
      include: {
        catalogItem: {
          select: { id: true, code: true, name: true, specification: true, category: true, group: true, unit: true },
        },
      },
    });
    return rows.map(r => ({ ...r, quotedPrice: Number(r.quotedPrice) }));
  }

  // ─── Dashboard Stats ───

  async getDashboardStats(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      include: {
        contacts: true,
        qualifications: true,
        bankAccounts: true,
        performances: true,
      },
    });
    if (!supplier) return null;

    const [
      evaluationCount,
      submissionCount,
      pendingChanges,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.supplierEvaluation.count({ where: { supplierId: supplier.id } }),
      this.prisma.supplierBidSubmission.count({ where: { supplierId: supplier.id, status: 'submitted' } }),
      this.prisma.supplierChangeRecord.count({ where: { supplierId: supplier.id, status: 'PENDING' } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    // Expiring qualifications
    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const expiringQualifications = await this.prisma.supplierQualification.count({
      where: {
        supplierId: supplier.id,
        validTo: { lte: thirtyDaysLater, gte: new Date() },
        status: '有效',
      },
    });

    // Profile completeness calculation
    const completeness = this.calculateProfileCompleteness(supplier);

    return {
      supplierStatus: supplier.status,
      evaluationCount,
      submissionCount,
      qualificationCount: supplier.qualifications.length,
      pendingChanges,
      unreadNotifications,
      expiringQualifications,
      profileCompleteness: completeness,
    };
  }

  /**
   * 注册 2.0 口径的资料完整度（满分 100）：
   *   基本信息 45（17 项：含 logo/机构代码/国别/区域/详细地址/注册资本/行业/法人电话/邮箱/官网）
   *   联系人 15（至少 1 个完整联系人 + 主要联系人 + 联系人身份证 + 性别）
   *   银行账户 10（至少 1 个户名/开户银行/账号齐全的账户）
   *   资质信息 20（营业执照 12 + 其他资质 ≥1 项 4 + 附加材料 4）
   *   主体业绩 10（至少 1 项业绩）
   */
  private calculateProfileCompleteness(supplier: any): {
    score: number;
    missing: string[];
    categories: {
      basic: { score: number; max: number; filled: number; total: number; missing: string[] };
      contacts: { score: number; max: number; filled: number; total: number; missing: string[]; count: number; hasPrimary: boolean };
      qualifications: { score: number; max: number; filled: number; total: number; missing: string[]; count: number; hasLicense: boolean };
      bankAccounts: { score: number; max: number; filled: number; total: number; missing: string[]; count: number };
      performances: { score: number; max: number; filled: number; total: number; missing: string[]; count: number };
    };
  } {
    const missing: string[] = [];

    // ── 基本信息（45 分，17 项）──
    let basicScore = 0;
    const basicMax = 45;
    const basicMissing: string[] = [];
    const basicTotal = 17;
    let basicFilled = 0;
    const basicItems: Array<[string, any, number]> = [
      ['企业名称', supplier.name, 3],
      ['统一社会信用代码', supplier.creditCode, 3],
      ['机构代码', supplier.organizationCode, 3],
      ['公司体制类型', supplier.enterpriseType, 2],
      ['法人姓名', supplier.legalPerson, 2],
      ['法人身份证号', supplier.legalPersonIdCard, 2],
      ['法人联系电话', supplier.legalPersonPhone, 3],
      ['注册地址', supplier.registeredAddress, 2],
      ['详细地址', supplier.detailedAddress, 3],
      ['经营范围', supplier.businessScope, 2],
      ['公司logo', supplier.logoUrl, 3],
      ['国别', supplier.country, 3],
      ['所属行政区域', supplier.region, 3],
      ['注册资本', supplier.registeredCapital, 2],
      ['所属行业', supplier.industry, 3],
      ['公司邮箱', supplier.companyEmail, 3],
      ['公司官网', supplier.companyWebsite, 3],
    ];
    for (const [label, value, pts] of basicItems) {
      if (value !== null && value !== undefined && String(value).trim() !== '') { basicScore += pts; basicFilled++; }
      else basicMissing.push(label);
    }
    missing.push(...basicMissing);

    // ── 联系人（15 分）──
    let contactScore = 0;
    const contactMax = 15;
    const contacts: any[] = supplier.contacts || [];
    const contactCount = contacts.length;
    const contactFilled = contactCount;
    const contactTotal = Math.max(contactCount, 1);
    const contactMissing: string[] = [];
    const hasCompleteContact = contacts.some((c) => c.name?.trim() && /^1\d{10}$/.test(c.phone?.trim() || ''));
    const contactHasPrimary = contacts.some((c) => c.isPrimary);
    if (hasCompleteContact) contactScore += 8; else contactMissing.push('联系人');
    if (contactHasPrimary) contactScore += 3; else contactMissing.push('主要联系人');
    if (contactCount > 0 && contacts.every((c) => c.idCard?.trim())) contactScore += 2; else contactMissing.push('联系人身份证号');
    if (contactCount > 0 && contacts.every((c) => c.gender)) contactScore += 2; else contactMissing.push('联系人性别');
    missing.push(...contactMissing);

    // ── 银行账户（10 分）──
    let bankScore = 0;
    const bankMax = 10;
    const banks: any[] = supplier.bankAccounts || [];
    const bankCount = banks.length;
    const bankMissing: string[] = [];
    const hasValidBank = banks.some((b) => b.accountName?.trim() && b.bankName?.trim() && b.accountNo?.trim());
    if (hasValidBank) bankScore += 10; else bankMissing.push('银行账户');
    missing.push(...bankMissing);

    // ── 资质信息（20 分）──
    let qualScore = 0;
    const qualMax = 20;
    const quals: any[] = supplier.qualifications || [];
    const qualCount = quals.length;
    const qualFilled = qualCount;
    const qualTotal = Math.max(qualCount, 1);
    const qualMissing: string[] = [];
    const qualHasLicense = quals.some((q) => q.type === '营业执照' && q.fileUrl);
    const hasOtherQual = quals.some((q) => q.type !== '营业执照' && q.fileUrl);
    const allHaveAttachments = qualCount > 0 && quals.every((q) => Array.isArray(q.attachments) && q.attachments.length > 0);
    if (qualHasLicense) qualScore += 12; else qualMissing.push('营业执照');
    if (hasOtherQual) qualScore += 4; else qualMissing.push('其他资质');
    if (allHaveAttachments) qualScore += 4; else qualMissing.push('资质附加材料');
    missing.push(...qualMissing);

    // ── 主体业绩（10 分）──
    let perfScore = 0;
    const perfMax = 10;
    const perfs: any[] = supplier.performances || [];
    const perfCount = perfs.length;
    const perfMissing: string[] = [];
    if (perfCount > 0) perfScore += 10; else perfMissing.push('主体业绩');
    missing.push(...perfMissing);

    const score = basicScore + contactScore + bankScore + qualScore + perfScore;

    return {
      score,
      missing,
      categories: {
        basic: { score: basicScore, max: basicMax, filled: basicFilled, total: basicTotal, missing: basicMissing },
        contacts: { score: contactScore, max: contactMax, filled: contactFilled, total: contactTotal, missing: contactMissing, count: contactCount, hasPrimary: contactHasPrimary },
        qualifications: { score: qualScore, max: qualMax, filled: qualFilled, total: qualTotal, missing: qualMissing, count: qualCount, hasLicense: qualHasLicense },
        bankAccounts: { score: bankScore, max: bankMax, filled: hasValidBank ? 1 : 0, total: 1, missing: bankMissing, count: bankCount },
        performances: { score: perfScore, max: perfMax, filled: perfCount > 0 ? 1 : 0, total: 1, missing: perfMissing, count: perfCount },
      },
    };
  }

  // ─── Password ───

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const { compareSync, hashSync } = await import('bcryptjs')
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user?.passwordHash || !compareSync(oldPassword, user.passwordHash)) {
      throw new BadRequestException({ error: '原密码不正确', code: 'WRONG_PASSWORD' })
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashSync(newPassword, 10) },
    })
    return { success: true }
  }

  // 临时供应商申请转为正式（提交资料变更请求，管理员审批后补全字段并取消 isTemporary）
  async convertToRegular(userId: string, dto: ConvertToRegularDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'NOT_FOUND' });
    if (!supplier.isTemporary) throw new BadRequestException({ error: '非临时供应商无需转正', code: 'NOT_TEMPORARY' });
    const record = await this.prisma.supplierChangeRecord.create({
      data: {
        supplierId: supplier.id,
        fieldName: 'convertToRegular',
        fieldLabel: '临时转正式',
        newValue: JSON.stringify({
          enterpriseType: dto.enterpriseType,
          legalPerson: dto.legalPerson,
          registeredAddress: dto.registeredAddress,
          businessScope: dto.businessScope,
          creditCode: dto.creditCode,
          contacts: dto.contacts,
          qualifications: dto.qualifications,
          tags: dto.tags,
        }),
        status: 'PENDING',
      },
    });
    return { success: true, record };
  }

  // P0-2：临时供应商过期续期（凭新邀请码；公开接口——过期账号登录不了，无法走鉴权调用）
  async reactivateTemporary(dto: { username: string; password: string; invitationCode: string }) {
    const { compareSync } = await import('bcryptjs');
    const user = await this.prisma.user.findFirst({
      where: { username: dto.username.trim(), role: 'supplier' },
      select: { id: true, passwordHash: true },
    });
    // 密码错误不区分账号是否存在（防枚举），但因续期需明确指引，单独提示
    if (!user?.passwordHash || !compareSync(dto.password, user.passwordHash)) {
      throw new BadRequestException({ error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' });
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId: user.id },
      select: { id: true, name: true, isTemporary: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'NOT_FOUND' });
    if (!supplier.isTemporary) throw new BadRequestException({ error: '正式供应商无需续期', code: 'NOT_TEMPORARY' });

    const code = dto.invitationCode.toUpperCase().trim();
    const inv = await this.prisma.supplierInvitation.findUnique({ where: { code } });
    if (!inv) throw new BadRequestException({ error: '邀请码不存在', code: 'INVITATION_NOT_FOUND' });
    if (inv.status !== 'ACTIVE') throw new BadRequestException({ error: `邀请码不可用（${inv.status}）`, code: 'INVITATION_INVALID' });
    if (inv.expiresAt < new Date()) throw new BadRequestException({ error: '邀请码已过期', code: 'INVITATION_EXPIRED' });

    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id: supplier.id }, data: { temporaryExpiresAt: inv.expiresAt } });
      await tx.supplierInvitation.update({
        where: { id: inv.id },
        data: { status: 'USED', usedById: supplier.id, usedAt: new Date() },
      });
    });
    return { success: true, temporaryExpiresAt: inv.expiresAt, validityDays: inv.validityDays, name: supplier.name };
  }

  // ── A-143（2026-08-28）：评标澄清在线答复（编辑+附件+SM2 电子签名，spec §3.4）──

  /** 寻址本司的评标澄清（type='clarification'）；EVALUATING/ARCHIVED 可见 */
  async listBidClarificationsForSupplier(projectId: string, supplierId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project) throw new NotFoundException({ error: '项目不存在', code: 'PROJECT_NOT_FOUND' });
    const membership = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierId }, select: { id: true } });
    if (!membership) throw new ForbiddenException({ error: '贵司非本项目投标人', code: 'NOT_BIDDER' });
    const items = await this.prisma.bidClarification.findMany({
      where: { projectId, type: 'clarification', supplierId },
      orderBy: { createdAt: 'asc' },
    });
    // 签名 payload 全串不回传列表（列表只给摘要）
    return items.map((c) => this.stripReplySignature(c));
  }

  /** 取 canonical 串（无状态、不落库）——前端直接对此串 U盾签名 */
  async getClarificationReplyPayload(
    projectId: string, cid: string, supplierId: string,
    user: { sub: string }, dto: ClarificationReplyDraftDto,
  ) {
    await this.assertReplyable(projectId, cid, supplierId);
    const attachments = await this.loadOwnedAttachments(dto.attachmentIds ?? [], user.sub);
    return {
      payload: buildClarificationReplyCanonical({
        clarificationId: cid, projectId, supplierId,
        reply: dto.reply, attachments, certSn: dto.certSn,
      }),
    };
  }

  /** 提交签名答复：重算 canonical + SM2 验签 + 落库 + WS 广播 */
  async submitClarificationReply(
    projectId: string, cid: string, supplierId: string,
    user: { sub: string; name?: string; username?: string }, dto: SubmitClarificationReplyDto,
  ) {
    const clar = await this.assertReplyable(projectId, cid, supplierId);

    // 证书严格校验：与 submitBid 同规则，不回退 supplier.sm2PublicKey（revokeCert 不清该列）
    const cert = await this.prisma.supplierCert.findFirst({
      where: { supplierId, certSn: dto.certSn, bindingStatus: 'ACTIVE' },
    });
    if (!cert) {
      throw new BadRequestException({ error: '证书未绑定或已撤销，请先在「U盾管理」绑定有效证书', code: 'CERT_NOT_ACTIVE' });
    }

    const attachments = await this.loadOwnedAttachments(dto.attachmentIds ?? [], user.sub);
    const canonical = buildClarificationReplyCanonical({
      clarificationId: cid, projectId, supplierId,
      reply: dto.reply, attachments, certSn: dto.certSn,
    });
    if (!this.signatureService.verify(canonical, dto.signature, cert.publicKey)) {
      throw new BadRequestException({ error: '电子签名验证失败，请使用绑定证书对最新答复内容重新签名', code: 'CLARIFICATION_REPLY_SIGNATURE_INVALID' });
    }

    // TOCTOU 收口（终审修复 2026-08-28）：assertReplyable 断言与写入之间可能插入第二笔
    // 并发提交——按主键无条件 update 会静默覆盖先到的答复（含 SM2 签名证据）。
    // 改条件 updateMany：仅 status=待回复 可写，count=0 即已被并发答复 → 409。
    const written = await this.prisma.bidClarification.updateMany({
      where: { id: cid, status: '待回复' },
      data: {
        reply: dto.reply,
        status: '已回复',
        replyChannel: 'online',
        replySignature: {
          v: 1, payload: canonical, signature: dto.signature,
          algorithm: 'SM2/SM3', certSn: dto.certSn, verifiedAt: new Date().toISOString(),
        },
        replyAttachmentIds: attachments.map((a) => ({ fileAssetId: a.fileAssetId, name: a.name, sha256: a.sha256 })),
        replyByName: user.name ?? user.username ?? null,
      },
    });
    if (written.count === 0) {
      throw new ConflictException({ error: '澄清已答复或已关闭，不可重复答复', code: 'CLARIFICATION_ALREADY_REPLIED' });
    }
    this.gateway?.notifyClarificationReplied(projectId, {
      id: cid, replier: 'supplier', replyPreview: dto.reply.slice(0, 60),
    });
    // updateMany 不回行——重取后剥离签名全串返回
    const refreshed = await this.prisma.bidClarification.findUnique({ where: { id: cid } });
    return this.stripReplySignature(refreshed!);
  }

  /** 私有：答复闸门——存在+寻址本人+待回复+评标中（spec §3.4 reply 流程 1） */
  private async assertReplyable(projectId: string, cid: string, supplierId: string) {
    const clar = await this.prisma.bidClarification.findFirst({
      where: { id: cid, projectId, type: 'clarification' },
    });
    if (!clar) throw new BadRequestException({ error: '澄清不存在或不属于此项目', code: 'CLARIFICATION_NOT_IN_PROJECT' });
    if (clar.supplierId !== supplierId) throw new ForbiddenException({ error: '该澄清并非寻址到贵司', code: 'NOT_CLARIFICATION_TARGET' });
    if (clar.status !== '待回复') throw new ConflictException({ error: '澄清已答复或已关闭，不可重复答复', code: 'CLARIFICATION_ALREADY_REPLIED' });
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true } });
    if (!project || project.stage !== 'EVALUATING') {
      throw new ConflictException({ error: '仅评标中（EVALUATING）可答复澄清', code: 'STAGE_NOT_EVALUATING' });
    }
    return clar;
  }

  /** 私有：附件归属校验——须为本司上传的 clarification_reply 类目（spec §3.4 流程 2） */
  private async loadOwnedAttachments(attachmentIds: string[], supplierUserId: string) {
    if (attachmentIds.length === 0) return [];
    const assets = await this.prisma.fileAsset.findMany({ where: { id: { in: attachmentIds } } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return attachmentIds.map((id) => {
      const a = byId.get(id);
      if (!a || a.category !== 'clarification_reply' || a.uploaderId !== supplierUserId) {
        throw new BadRequestException({ error: `附件不可用或非本司上传：${id}`, code: 'ATTACHMENT_INVALID' });
      }
      return { fileAssetId: a.id, sha256: a.sha256, name: a.originalName };
    });
  }

  /** 私有：对外响应剥离 payload 全串，只留摘要 */
  private stripReplySignature<T extends { replySignature: unknown }>(row: T) {
    const sig = row.replySignature as { algorithm?: string; certSn?: string; verifiedAt?: string } | null;
    return { ...row, replySignature: sig ? { algorithm: sig.algorithm, certSn: sig.certSn, verifiedAt: sig.verifiedAt } : null };
  }
}
