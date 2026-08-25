import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { minioClient, MINIO_BUCKET, ensureBucket } from './minio.client';
import { BID_FILE_ROLES } from '@water-erp/shared';
import { convertOfficeToPdf, sanitizeFileName } from '../common/office-to-pdf.util';
import { unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { createDecryptStream } from '../announcement/bid-document.crypto';

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
];

const ALLOWED_CATEGORIES = [
  'qualification',  // 资质材料
  'bid_document',   // 投标文件
  'announcement',   // 公告附件
  'profile',        // 供应商资料
  'expert_signin_photo', // 专家签到拍照留痕（evaluate 身份核验步骤，非人脸识别）
  'general',        // 通用
];

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);

  constructor(private prisma: PrismaService) {}

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
  generateKey(originalName: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const ext = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    return `uploads/${date}/${hash}.${ext}`;
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

    if (!ALLOWED_CATEGORIES.includes(category)) {
      throw new BadRequestException({
        error: `不支持的文件分类：${category}`,
        code: 'INVALID_CATEGORY',
      });
    }
  }

  /**
   * 上传文件并持久化元数据（文件字节写入 MinIO）
   */
  async upload(
    file: Express.Multer.File, category: string = 'general', userId?: string,
    clientEncrypted = false,
    clientPlaintextSha256?: string,
  ) {
    // clientEncrypted 时跳过 MIME 校验——密文的 MIME type 是 application/octet-stream
    if (!clientEncrypted) {
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

    const key = this.generateKey(displayName);
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
    asset: { id: string; uploaderId: string | null; category: string },
    user: { sub: string; role: string },
  ): Promise<boolean> {
    if (asset.uploaderId && asset.uploaderId === user.sub) return true;

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
        select: { id: true, logoUrl: true },
      });
      if (!supplier) return false;
      const [quals, perfs] = await Promise.all([
        this.prisma.supplierQualification.findMany({
          where: { supplierId: supplier.id },
          select: { fileUrl: true, attachments: true },
        }),
        this.prisma.supplierPerformance.findMany({
          where: { supplierId: supplier.id },
          select: { proofFiles: true },
        }),
      ]);
      const urls = new Set<string>();
      if (supplier.logoUrl) urls.add(supplier.logoUrl);
      for (const q of quals) {
        urls.add(q.fileUrl);
        for (const a of (q.attachments as Array<{ url?: string }> | null) ?? []) if (a?.url) urls.add(a.url);
      }
      for (const p of perfs) {
        for (const a of (p.proofFiles as Array<{ url?: string }>) ?? []) if (a?.url) urls.add(a.url);
      }
      for (const u of urls) {
        if (u && (u.endsWith(`/files/${asset.id}`) || u.endsWith(`/${asset.id}`))) return true;
      }
      return false;
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
