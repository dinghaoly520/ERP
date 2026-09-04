import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { fileCategoryDefaults } from '@water-erp/shared';
import { minioClient, MINIO_BUCKET, ensureBucket } from './minio.client';
import { BID_FILE_ROLES } from '@water-erp/shared';
import { convertOfficeToPdf, sanitizeFileName } from '../common/office-to-pdf.util';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { createDecryptStream } from '../announcement/bid-document.crypto';
import { UPLOAD_CATEGORIES } from './upload-categories';
import { matchesFileContentPolicy, PDF_WORD_IMAGE_MIME_TYPES } from './file-content-policy';
import { CompanyScopeService } from '../company/company-scope';

/** Allowed MIME types for upload */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/plain',
];

/** P0-5：开评标留痕资产类目——删除一律 409 FILE_PROTECTED（办法第49条不得损毁；审计 P0-5 剩余面，2026-08-24） */
const EVIDENCE_PROTECTED_CATEGORIES = [
  'bid_opening_handover',       // 开标文件包（完成开标·资料移交）
  'bid_evaluation_handover',    // 评标完整性包
  'bid_evaluation_sign_handover', // 评标回流包
  'bid_sign_packet',            // 评标签字包 PDF/DOCX
  'sign_packet_signature_page', // 签字页扫描（全员共签页）
  'expert_sign_scan',           // 专家签字/不同意见书扫描
  'expert_memo_ink',            // 专家手写备忘录
  'expert_signin_photo',        // 专家签到拍照留痕
  'opening_sign_page',          // P1-3①A：开标记录签字页 PDF
  'opening_sign_scan',          // P1-3①A：开标签字扫描件（主持人/监督人）
  'clarification_reply',        // A-143：澄清答复附件（证据件，不得损毁）
  'supervision_push_packet',    // A-153：推送信封物证
  'supervision_push_voucher',   // A-153：离线凭证物证
];

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private prisma: PrismaService,
    private companyScope: CompanyScopeService,
  ) {}

  async onModuleInit() {
    // 启动时确保 bucket 存在；MinIO 不可用时不阻断应用启动，仅记录告警
    try {
      await ensureBucket();
    } catch (err) {
      this.logger.error(`MinIO bucket 初始化失败：${(err as Error).message}`);
    }
  }

  /**
   * 生成文件存储 key: uploads/{yyyy-mm-dd}/{random}.{ext}
   */
  generateKey(originalName: string, namespace = 'uploads'): string {
    const date = new Date().toISOString().slice(0, 10);
    const ext = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    return `${namespace}/${date}/${hash}.${ext}`;
  }

  /**
   * 计算文件 SHA256
   */
  private computeSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * 校验文件合法性
   */
  validateFile(file: Express.Multer.File, category: string) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        error: `不支持的文件类型：${file.mimetype}`,
        code: 'INVALID_MIME_TYPE',
      });
    }

    if (!UPLOAD_CATEGORIES.has(category)) {
      throw new BadRequestException({
        error: `不支持的文件分类：${category}`,
        code: 'INVALID_CATEGORY',
      });
    }

    if (category === 'contract_document') {
      if (!matchesFileContentPolicy(file, PDF_WORD_IMAGE_MIME_TYPES)) {
        throw new BadRequestException({
          error: '合同或履约证明文件的扩展名、MIME 类型或文件内容不一致',
          code: 'CONTRACT_DOCUMENT_TYPE_MISMATCH',
        });
      }
    }
  }

  /**
   * 上传文件并持久化元数据（文件字节写入 MinIO）
   */
  async upload(
    file: Express.Multer.File, category: string = 'general', userId?: string,
    clientEncrypted = false,
    clientPlaintextSha256?: string,
    keyNamespace?: string,
  ) {
    // clientEncrypted 时跳过 MIME 校验（密文恒为 octet-stream），但 category 白名单仍须校验
    // ——防伪造任意类目（如 clarification_reply）对全体开评标管理角色可见
    if (clientEncrypted) {
      if (!UPLOAD_CATEGORIES.has(category)) {
        throw new BadRequestException({
          error: `不支持的文件分类：${category}`,
          code: 'INVALID_CATEGORY',
        });
      }
      if (clientPlaintextSha256 && !/^[a-f0-9]{64}$/i.test(clientPlaintextSha256)) {
        throw new BadRequestException({ error: 'plaintextSha256 须为 64 位 hex', code: 'BAD_SHA256' });
      }
    } else {
      this.validateFile(file, category);
    }

    // ① 文件名从 multer 的 latin1 还原为 utf8（中文不乱码）
    const originalName = sanitizeFileName(file.originalname);

    // ② Office Word 文档自动转 PDF（预览统一，转换失败降级存原始文件）
    //    clientEncrypted 时跳过——文件已是密文，无法识别为 Office 文档
    let buffer = file.buffer;
    let mimeType = file.mimetype;
    let displayName = originalName;
    if (!clientEncrypted) {
      const converted = convertOfficeToPdf(file.buffer, file.mimetype, originalName);
      if (converted) {
        buffer = converted.buffer;
        mimeType = converted.mimeType;
        displayName = converted.fileName;
      }
    } else {
      // E2EE: 统一标记为 octet-stream
      mimeType = 'application/octet-stream';
    }

    const key = this.generateKey(displayName, keyNamespace);
    // sha256: 客户端提供原文哈希则用它；否则计算密文哈希
    const sha256 = clientPlaintextSha256 || this.computeSha256(buffer);

    // 写入 MinIO 对象存储
    await minioClient.putObject(MINIO_BUCKET, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
    this.logger.log(`File stored in MinIO: ${key} (${buffer.length} bytes, ${mimeType})${clientEncrypted ? ' [E2EE]' : ''}`);

    // 持久化文件元数据到数据库
    const asset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: displayName,
        mimeType,
        size: buffer.length,
        sha256,
        category,
        uploaderId: userId,
        clientEncrypted, // E2EE 标记持久化
        // A2（表 B.1）：按类目默认分级（递交件=应保密/权益域、采购文件=可公开、内部件=应保密）
        ...fileCategoryDefaults(category),
      },
    });

    // url 为鉴权代理下载路径（稳定、不失效、受 AuthGuard 保护）
    return {
      id: asset.id,
      key: asset.key,
      url: `/api/upload/files/${asset.id}`,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      size: asset.size,
      category: asset.category,
      sha256: asset.sha256,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  /**
   * 以流的方式返回文件内容（鉴权下载）。受全局 AuthGuard 保护。
   * 在流出文件前校验访问权限：上传者本人、采购/开评标管理角色可直接访问；
   * 评审专家仅可访问其被分配项目中、且对应投标供应商已解密成功的投标文件。
   */
  async streamFile(id: string, user: { sub: string; role: string }, res: any) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException({ error: '文件不存在', code: 'NOT_FOUND' });
    }

    const canAccess = await this.canAccessFile(asset, user);
    if (!canAccess) {
      throw new ForbiddenException({ error: '无权访问该文件', code: 'FILE_FORBIDDEN' });
    }

    // §5.4a 新轨 C_outer 拒收（置于 E2EE AES 分支之前）：dual-v2 四列引用的 bid_document 密文
    // 对任何人都不提供下载——解密必须走开标解密流程（主持端 decrypt-outer → 供应商 decrypt-upload）。
    // 判定限定 envelopeVersion='dual-v2'，不误伤旧轨 clientEncrypted 资产（旧轨供应商本人下载明文是合法功能）。
    if (asset.category === 'bid_document') {
      const dualSubmission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          envelopeVersion: 'dual-v2',
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
            { bidBondAssetId: asset.id },
          ],
        },
        select: { id: true },
      });
      if (dualSubmission) {
        throw new BadRequestException({
          error: '双层信封密文不提供下载；请走开标解密流程',
          code: 'SEALED_NO_DOWNLOAD',
        });
      }
    }

    // E2EE: 文件在 MinIO 中是 ciphertext，需在流式输出时解密
    if (asset.clientEncrypted) {
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      const sealedKey = submission?.technicalFileAssetId === asset.id ? submission?.technicalSealedKey
        : submission?.businessFileAssetId === asset.id ? submission?.businessSealedKey
        : submission?.coverLetterSealedKey;
      if (!sealedKey) {
        throw new BadRequestException({ error: 'E2EE 文件缺少解密密钥', code: 'MISSING_SEALED_KEY' });
      }
      const rawKey = isWrappedKey(sealedKey) ? unwrapKey(sealedKey, process.env.KMS_SECRET!) : sealedKey;

      // 流式解密：从 MinIO 读取 ciphertext → AES-256-GCM decrypt → 响应
      const cipherStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
      const decryptStream = createDecryptStream(rawKey);

      // E2EE 文件在 MinIO 中存的是 ciphertext，不含 authTag → size 是 ciphertext 长度
      // 解密后会略短（去掉 authTag 长度），无法提前知道 Content-Length
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(asset.originalName.replace(/\.enc$/, ''))}"`,
      );
      cipherStream.pipe(decryptStream).pipe(res);
      return;
    }

    // 旧轨服务端密封资产（encrypted && sealedPath，clientEncrypted=false）：
    // clean-legacy-plaintext 清理 asset.key 明文原对象后，通用分支必须从 sealedPath
    // 读密文并 KMS 解包 sealedKey 流式解密输出（口径镜像 plaintext-fetcher：
    // sealedPath || key 读点 + isWrappedKey→unwrapKey + AES 解密）。否则供应商回看/
    // staff/专家下载此类资产会 404。dual-v2 已在前置 SEALED_NO_DOWNLOAD 拒收，不落此分支。
    if (asset.encrypted && asset.sealedPath) {
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      const sealedKey = submission?.technicalFileAssetId === asset.id ? submission?.technicalSealedKey
        : submission?.businessFileAssetId === asset.id ? submission?.businessSealedKey
        : submission?.coverLetterSealedKey;
      if (!sealedKey) {
        throw new BadRequestException({ error: '密封文件缺少解密密钥', code: 'MISSING_SEALED_KEY' });
      }
      const rawKey = isWrappedKey(sealedKey) ? unwrapKey(sealedKey, process.env.KMS_SECRET!) : sealedKey;

      const sealedStream = await minioClient.getObject(MINIO_BUCKET, asset.sealedPath);
      const sealedDecryptStream = createDecryptStream(rawKey);
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(asset.originalName)}"`,
      );
      sealedStream.pipe(sealedDecryptStream).pipe(res);
      return;
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.size));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(asset.originalName)}"`,
    );

    const dataStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
    dataStream.pipe(res);
    return dataStream;
  }

  /**
   * 文件访问权限判定：
   * - 上传者本人：允许
   * - §5.4a 新轨 C_inner（bid_inner_ciphertext）：反查 submission.innerAssets 归属链，
   *   仅该项目 BidSupplier 对应的登录用户放行（现四列规则不含等待解密中的供应商本人）
   * - §5.4a 新轨明文（bid_decrypted）：反查 submission.decryptedAssets 归属链——项目成员本人、
   *   admin / bid_host / leader / staff（要求该供应商 decryptStatus=SUCCESS）、
   *   本项目专家（SUCCESS 门控复用）
   *   ★ 两分支必须先于下方「四列反查」通用规则——新轨资产不在四列中，通用规则会把
   *   staff/专家 判为「非投标文件 → 放行」，绕过 SUCCESS 门控与成员规则
   * - admin / bid_host / leader / staff：允许，但若文件属于供应商投标提交则需 decryptStatus=SUCCESS
   * - bid_expert：仅当被分配到某项目，且该文件属于该项目某供应商提交的投标文件，
   *   且对应 BidSupplier 已解密成功时允许
   * - 其他：拒绝
   */
  private async canAccessFile(
    asset: { id: string; uploaderId: string | null; category: string; key?: string | null },
    user: { sub: string; role: string },
  ): Promise<boolean> {
    // 合同/履约/成交通知书资产没有 companyId，必须先沿真实引用链判定公司归属。
    // 此检查刻意位于 uploader 快速放行之前：存量数据中即使他企经办人曾上传该文件，
    // 一旦它已成为另一公司的合同证据，也不能靠 uploaderId 绕过公司隔离。
    if (['admin', 'bid_host', 'leader', 'staff'].includes(user.role)) {
      const contractAccess = await this.contractReferenceAccess(asset.id, user);
      if (contractAccess !== null) return contractAccess;
    }

    if (asset.uploaderId && asset.uploaderId === user.sub) return true;

    // A-143：澄清答复附件——上传人（供应商）之外，开评标现场/管理角色可见（答复本就在主持端展示）
    // A-153：监督推送信封/凭证——管理角色可见
    if (
      asset.category === 'clarification_reply' ||
      asset.category === 'supervision_push_packet' ||
      asset.category === 'supervision_push_voucher'
    ) {
      return ['admin', 'bid_host', 'leader', 'staff'].includes(user.role);
    }

    if (asset.category === 'bid_inner_ciphertext') {
      // §5.2 成员规则：innerAssets 归属链反查（asset.id 是某角色 C_inner）→ 成员本人放行
      const submission = await this.findSubmissionByDualAssets('innerAssets', asset.id);
      if (!submission) return false;
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: submission.supplierId },
        select: { userId: true },
      });
      return !!supplier && supplier.userId === user.sub;
    }

    if (asset.category === 'bid_decrypted') {
      // decryptedAssets 归属链反查；成员兜底（正常 uploaderId=supplier.userId 已被本人检查放行）
      const submission = await this.findSubmissionByDualAssets('decryptedAssets', asset.id);
      if (!submission) return false;
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: submission.supplierId },
        select: { userId: true },
      });
      if (supplier && supplier.userId === user.sub) return true;

      if (['admin', 'bid_host', 'leader', 'staff'].includes(user.role)) {
        const decrypted = await this.prisma.bidSupplier.findFirst({
          where: { projectId: submission.projectId, supplierId: submission.supplierId, decryptStatus: 'SUCCESS' },
        });
        return !!decrypted;
      }

      if (user.role === 'bid_expert') {
        const expert = await this.prisma.bidExpert.findFirst({
          where: { userId: user.sub, projectId: submission.projectId },
        });
        if (!expert) return false;
        const bidSupplier = await this.prisma.bidSupplier.findFirst({
          where: { projectId: submission.projectId, supplierId: submission.supplierId, decryptStatus: 'SUCCESS' },
        });
        if (!bidSupplier) return false;

        // 审计：记录专家文件访问（与四列分支同款）
        await this.prisma.bidSupervisionLog.create({
          data: {
            projectId: submission.projectId,
            time: new Date(),
            role: '专家',
            target: bidSupplier.supplierName,
            action: '文件访问',
            result: `专家预览/下载投标文件 (asset: ${asset.id})`,
            riskFlag: '无',
          },
        });

        return true;
      }

      return false;
    }

    if (['admin', 'bid_host', 'leader', 'staff'].includes(user.role)) {
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      if (submission) {
        const decrypted = await this.prisma.bidSupplier.findFirst({
          where: { projectId: submission.projectId, supplierId: submission.supplierId, decryptStatus: 'SUCCESS' },
        });
        return !!decrypted;
      }
      return true;
    }

    // ── 供应商本人档案文件：logo / 资质主文件与附加材料 / 业绩证明材料 ──
    // 注册资料可能由采购端代传（uploader 非本供应商），供应商查看自己档案挂载的文件应放行；
    // 仅限本企业记录引用的 asset，不扩大到他企文件。
    if (user.role === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({
        where: { userId: user.sub },
        select: { id: true, userId: true, logoUrl: true },
      });
      if (!supplier) return false;

      // 交易结果与合同文件可能由采购端生成/上传。这里按真实业务引用链授权，
      // 不依赖 uploaderId，且只允许当前供应商主体命中的记录。
      const [contractFile, fulfillmentFile] = await Promise.all([
        this.prisma.contract.findFirst({
          where: {
            supplierId: supplier.id,
            signedAssetId: asset.id,
            status: { in: ['signed', 'performing', 'accepted', 'terminated'] },
          },
          select: { id: true },
        }),
        this.prisma.contractFulfillment.findFirst({
          where: {
            proofAssetId: asset.id,
            contract: {
              supplierId: supplier.id,
              status: { in: ['signed', 'performing', 'accepted', 'terminated'] },
            },
          },
          select: { id: true },
        }),
      ]);
      if (contractFile || fulfillmentFile) return true;

      const ownedBidSuppliers = await this.prisma.bidSupplier.findMany({
        where: { supplierId: supplier.id },
        select: { id: true },
      });
      if (ownedBidSuppliers.length > 0) {
        const awardLetter = await this.prisma.awardLetterDelivery.findFirst({
          where: {
            letterAssetId: asset.id,
            supplierId: { in: ownedBidSuppliers.map((item) => item.id) },
          },
          select: { id: true },
        });
        if (awardLetter) return true;
      }

      // 【防伪造】本分支内所有"URL 引用"类判定改为双闸门：
      //  ① 引用行的 URL 必须精确等于 `/api/upload/files/${asset.id}`（拒绝 endsWith 后缀匹配，
      //    防止构造 `xxx/files/<他企id>` 绕过）；
      //  ② 被引用 asset 须为本供应商上传，或采购管理端（admin/leader/staff）代传——
      //    供应商无法引用【另一供应商】上传的文件（防跨界读取他企资质/证件）。
      const refOk = (url: unknown) =>
        typeof url === 'string' && url === `/api/upload/files/${asset.id}`;
      const assetTrusted = async (): Promise<boolean> => {
        if (!asset.uploaderId || asset.uploaderId === supplier.userId) return true;
        const uploader = await this.prisma.user.findUnique({
          where: { id: asset.uploaderId },
          select: { role: true },
        });
        return ['admin', 'leader', 'staff'].includes(uploader?.role ?? '');
      };

      // 第一步：本企业记录中是否存在精确引用（无则直接 false，不查 uploader）
      let referenced = false;
      if (refOk(supplier.logoUrl)) {
        referenced = true;
      } else {
        const [quals, perfs, archives] = await Promise.all([
          this.prisma.supplierQualification.findMany({
            where: { supplierId: supplier.id },
            select: { fileUrl: true, attachments: true },
          }),
          this.prisma.supplierPerformance.findMany({
            where: { supplierId: supplier.id },
            select: { proofFiles: true },
          }),
          this.prisma.supplierOwnArchive.findMany({
            where: { supplierId: supplier.id },
            select: { files: true },
          }),
        ]);
        for (const q of quals) {
          if (refOk(q.fileUrl)) { referenced = true; break; }
          if ((q.attachments as Array<{ url?: string }> | null)?.some((a) => refOk(a?.url))) { referenced = true; break; }
        }
        if (!referenced) {
          for (const pf of perfs) {
            if ((pf.proofFiles as Array<{ url?: string }> | null)?.some((f) => refOk(f?.url))) { referenced = true; break; }
          }
        }
        if (!referenced) {
          for (const ar of archives) {
            if ((ar.files as Array<{ url?: string }> | null)?.some((f) => refOk(f?.url))) { referenced = true; break; }
          }
        }
      }
      // 采购邀请书（general/invitation/{业务编号}/{ts}.docx）：该编号项目的受邀供应商可预览
      if (asset.key?.startsWith('general/invitation/')) {
        const bizCode = asset.key.split('/')[2];
        if (bizCode) {
          const invited = await this.prisma.bidSupplier.findFirst({
            where: {
              supplierId: supplier.id,
              project: { projectManagementItem: { projectCode: bizCode } },
            },
            select: { id: true },
          });
          if (invited) return true;
        }
      }

      if (!referenced) return false;
      return assetTrusted();
    }

    if (user.role === 'bid_expert') {
      // 从 asset 反查其所属项目（通过引用该 asset 的 SupplierBidSubmission），
      // 再校验专家是否被分配到【该】项目——避免对多项目专家取到错误项目导致误判。
      const submission = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
          ],
        },
      });
      if (!submission) return false;
      const expert = await this.prisma.bidExpert.findFirst({
        where: { userId: user.sub, projectId: submission.projectId },
      });
      if (!expert) return false;
      const bidSupplier = await this.prisma.bidSupplier.findFirst({
        where: { projectId: submission.projectId, supplierId: submission.supplierId, decryptStatus: 'SUCCESS' },
      });
      if (!bidSupplier) return false;

      // 审计：记录专家文件访问
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId: submission.projectId,
          time: new Date(),
          role: '专家',
          target: bidSupplier.supplierName,
          action: '文件访问',
          result: `专家预览/下载投标文件 (asset: ${asset.id})`,
          riskFlag: '无',
        },
      });

      return true;
    }

    return false;
  }

  /**
   * 返回 null 表示资产未被合同证据链或成交通知书引用，调用方继续既有投标/上传人规则；
   * 返回 boolean 表示已有上述业务引用，必须按公司范围作最终判定。
   */
  private async contractReferenceAccess(
    assetId: string,
    user: { sub: string; role: string },
  ): Promise<boolean | null> {
    const [contractRefs, fulfillmentRefs, awardLetterRefs] = await Promise.all([
      this.prisma.contract.findMany({
        where: { OR: [{ draftAssetId: assetId }, { signedAssetId: assetId }] },
        select: { companyId: true },
      }),
      this.prisma.contractFulfillment.findMany({
        where: { proofAssetId: assetId },
        select: { contract: { select: { companyId: true } } },
      }),
      this.prisma.awardLetterDelivery.findMany({
        where: { letterAssetId: assetId },
        select: { project: { select: { companyId: true, assignedHostUserId: true } } },
      }),
    ]);
    if (contractRefs.length === 0 && fulfillmentRefs.length === 0 && awardLetterRefs.length === 0) return null;

    const scope = await this.companyScope.resolveScope(user as any);
    if (scope.all) return true;

    const contractCompanyIds: Array<string | null> = [
      ...contractRefs.map((reference) => reference.companyId),
      ...fulfillmentRefs.map((reference) => reference.contract.companyId),
    ];
    const awardCompanyIds = awardLetterRefs.map((reference) => reference.project.companyId);

    // 同时存在合同引用时，始终以合同公司域为准，不得用主持人指派例外绕过。
    if (contractCompanyIds.length > 0) {
      return [...contractCompanyIds, ...awardCompanyIds]
        .every((companyId) => companyId === scope.companyId);
    }

    if (awardCompanyIds.every((companyId) => companyId === scope.companyId)) return true;
    // 镜像 BidCompanyScopeGuard：被明确指派的主持人可跨公司回看自己负责项目；
    // 资产若被多个通知书引用，必须每条均是该主持人的指派项目。
    return user.role === 'bid_host'
      && awardLetterRefs.every((reference) => reference.project.assignedHostUserId === user.sub);
  }

  /**
   * §5.4a 归属链反查：新轨 C_inner / bid_decrypted 资产不在 submission 四列中，
   * 必须经 innerAssets/decryptedAssets 两 Json 列解析归属。
   * 角色是封闭集合（EnvelopeRole），按 path 精确匹配各角色键。
   */
  private async findSubmissionByDualAssets(
    column: 'innerAssets' | 'decryptedAssets',
    assetId: string,
  ): Promise<{ supplierId: string; projectId: string } | null> {
    const roles = BID_FILE_ROLES; // backlog-E：角色集单一来源（packages/shared），与 EnvelopeRole 对齐
    return this.prisma.supplierBidSubmission.findFirst({
      where: {
        OR: roles.map(role => ({ [column]: { path: [role], equals: assetId } })),
      },
      select: { supplierId: true, projectId: true },
    });
  }

  /**
   * 删除文件（MinIO 对象 + 元数据）
   */
  async delete(key: string, user?: { sub: string; role: string }) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { key } });
    if (!asset) {
      throw new BadRequestException({ error: '文件不存在', code: 'NOT_FOUND' });
    }

    // 越权防护：仅上传者本人或 admin/bid_host 可删除
    // （原实现完全无鉴权，任意登录用户拿到 key 即可删他人投标/招标/AI 报告文件）
    const isAdmin = !!user && ['admin', 'bid_host'].includes(user.role);
    if (!isAdmin && asset.uploaderId !== user?.sub) {
      throw new ForbiddenException({ error: '无权删除该文件', code: 'FILE_FORBIDDEN' });
    }

    // §5.5b（Task 18）解密链路资产删除保护——置于四列引用保护之前：
    // ① 新轨 C_inner / 明文资产不在 submission 四列中，通用规则漏不掉也得拦——按类目整体禁删；
    // ② dual-v2 C_outer 恰在四列内，必须先按 dual-v2 口径给 FILE_PROTECTED（否则被通用规则吞成 FILE_REFERENCED）。
    if (asset.category === 'bid_inner_ciphertext' || asset.category === 'bid_decrypted') {
      throw new ConflictException({ error: '该文件属开标解密链路资产，禁止删除', code: 'FILE_PROTECTED' });
    }
    if (asset.category === 'bid_document') {
      const dualOuter = await this.prisma.supplierBidSubmission.findFirst({
        where: {
          envelopeVersion: 'dual-v2',
          OR: [
            { technicalFileAssetId: asset.id },
            { businessFileAssetId: asset.id },
            { coverLetterAssetId: asset.id },
            { bidBondAssetId: asset.id },
          ],
        },
        select: { id: true },
      });
      if (dualOuter) {
        throw new ConflictException({ error: '该文件属开标解密链路资产，禁止删除', code: 'FILE_PROTECTED' });
      }
    }

    // P0-5：开评标留痕资产删除保护（审计 P0-5 剩余面，2026-08-24）——
    // ① category 保护集：归档包/签字包/扫描件等留痕类目整体禁删；
    // ② 引用反查兜底：category 不在集内但被留痕关键列引用的资产（如中标通知书 DOCX）同样禁删。
    if ((EVIDENCE_PROTECTED_CATEGORIES as readonly string[]).includes(asset.category)) {
      throw new ConflictException({ error: '该文件属开评标留痕资产，禁止删除', code: 'FILE_PROTECTED' });
    }
    const evidenceRefs = await Promise.all([
      this.prisma.bidOpeningSession.findFirst({ where: { handoverAssetId: asset.id }, select: { id: true } }),
      this.prisma.bidSignPacket.findFirst({
        where: { OR: [{ fileAssetId: asset.id }, { signPageScanFileId: asset.id }, { handoverFileAssetId: asset.id }] },
        select: { id: true },
      }),
      this.prisma.bidExpert.findFirst({ where: { signScanFileId: asset.id }, select: { id: true } }),
      this.prisma.awardLetterDelivery.findFirst({ where: { letterAssetId: asset.id }, select: { id: true } }),
      this.prisma.expertMemo.findFirst({ where: { inkFileId: asset.id }, select: { id: true } }),
      this.prisma.openingHallMessage.findFirst({ where: { fileAssetId: asset.id }, select: { id: true } }),
      this.prisma.contract.findFirst({
        where: { OR: [{ draftAssetId: asset.id }, { signedAssetId: asset.id }] },
        select: { id: true },
      }),
      this.prisma.contractFulfillment.findFirst({ where: { proofAssetId: asset.id }, select: { id: true } }),
    ]);
    if (evidenceRefs.some(Boolean)) {
      throw new ConflictException({ error: '该文件被开评标留痕引用，禁止删除', code: 'FILE_PROTECTED' });
    }

    // H7: 已被投标文件引用的资产不可删除——防供应商截标后删件伪装技术故障 / 触发解密误判（H1 组合）
    const submission = await this.prisma.supplierBidSubmission.findFirst({
      where: {
        OR: [
          { technicalFileAssetId: asset.id },
          { businessFileAssetId: asset.id },
          { coverLetterAssetId: asset.id },
          { bidBondAssetId: asset.id },
        ],
      },
      select: { id: true },
    });
    if (submission) {
      throw new ConflictException({ error: '该文件已被投标文件引用，不可删除', code: 'FILE_REFERENCED' });
    }

    // 先删对象，再删元数据；任一失败抛错以暴露问题
    await minioClient.removeObject(MINIO_BUCKET, key);
    this.logger.log(`File removed from MinIO: ${key} (by ${user?.sub ?? 'system'})`);

    await this.prisma.fileAsset.delete({ where: { key } });
    return { deleted: true, key };
  }
}
