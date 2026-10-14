/** 双信封解密域（F1d）。legacy 代解密剪除后（2026-10-14 用户裁定）：decryptOuter/decryptOuterOne(V3)/adjudicateDecryptFault/acceptSupplierDanger（+私有解密证明） */
import { Injectable, BadRequestException, ConflictException, ForbiddenException, Optional, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { BidService } from './bid.service'; // 值导入：emitDecoratorMetadata 需运行时引用，import type 会退化为 Object 致 DI 失败
import { assertPriceMatchesSealed, assertPeriodMatchesSubmitted } from './opening-record-assert.util';
import { notifySupplierDecryptAttribution } from './decrypt-notify.util';
import { assertDecryptCheckInQuorum } from './decrypt-quorum.util';
import { encryptBuffer, decryptBuffer, streamToBuffer, verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { wrapKey, unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { Prisma } from '@prisma/client';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { sha256Hex } from '@water-erp/ukey';
import { randomUUID } from 'crypto';
import { DUAL_V2_AMOUNT_UNIT } from './opening-amount-unit.util';
import type { DualEnvelope, EnvelopeFileEntry, EnvelopeRole, DualV3Envelope, DualV3FileEntry } from '@water-erp/ukey';

/** 双信封 v2 角色 → 提交记录资产引用列（与 supplier-portal reupload-dual 的 ROLE_ASSET_KEYS 同构，勿漂移） */
const DUAL_ROLE_ASSET_KEYS = {
  technical: 'technicalFileAssetId',
  business: 'businessFileAssetId',
  coverLetter: 'coverLetterAssetId',
  bond: 'bidBondAssetId',
} as const;

/** decryptOuter 单家明细（单家路径直接返回该明细；批量路径以 details 数组聚合） */
export type DecryptOuterDetail =
  | { supplierId: string; supplierName: string; skipped: true }
  | { supplierId: string; supplierName: string; success: true; roles: EnvelopeRole[]; innerAssets: Record<string, string> }
  | { supplierId: string; supplierName: string; success: false; error?: string; code?: string };

export type DecryptOuterResult =
  | DecryptOuterDetail
  | { total: number; success: number; skipped: number; failed: number; details: DecryptOuterDetail[] };

@Injectable()
export class BidDecryptService {
  constructor(
    private prisma: PrismaService,
    private readonly dualEnvelope: DualEnvelopeService,
    private readonly adminKey: AdminKeyService,
    private notificationService: NotificationService,
    private readonly bidService: BidService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  private readonly logger = new Logger(BidDecryptService.name);

  /* ═══ Task 12：主持端解外层（dual-v2）—— 管理方私钥解 K_admin → C_inner 归属链落库 ═══ */

  /**
   * 主持端解外层：逐角色读 C_outer（sealedPath || key）→ decryptOuterFile 剥外层 → C_inner
   * 写 MinIO `bid-inner/<projectId>/<bidSupplierId>/<role>.inner` → FileAsset
   * （category=bid_inner_ciphertext）→ submission.innerAssets 归属链 + outerDecryptedAt。
   * supplierId 缺省 = 批量：预筛（dual-v2 && 未解外层 && 未撤回）逐家串行（一次一家一文件），
   * 逐家独立成败返回明细数组。
   */
  async decryptOuter(projectId: string, supplierId?: string, actorId?: string): Promise<DecryptOuterResult> {
    // ── 门控（同 decryptSupplier：OPENING + 会话存在 + 窗口开 + 未暂停）──
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法解外层', code: 'PROJECT_NOT_OPENING' });
    }
    const session = await this.prisma.bidOpeningSession.findUnique({ where: { projectId } });
    if (!session) {
      throw new BadRequestException({ error: '开标尚未启动，无法解外层', code: 'OPENING_NOT_STARTED' });
    }
    if (session.pausedAt) {
      throw new BadRequestException({ error: '开标已暂停，解外层操作暂时禁止', code: 'OPENING_PAUSED' });
    }
    const now = new Date();
    if (now < session.decryptWindowStart) {
      throw new BadRequestException({ error: '解密窗口尚未开启', code: 'DECRYPT_WINDOW_NOT_OPEN' });
    }
    if (now > session.decryptWindowEnd) {
      throw new BadRequestException({ error: '解密窗口已关闭', code: 'DECRYPT_WINDOW_CLOSED' });
    }

    if (supplierId) return this.decryptOuterOne(projectId, supplierId, actorId);

    // ── 批量：预筛后逐家串行；单家失败不阻塞其余家 ──
    // 楔感知：outerDecryptedAt 为 null 的正常家，或陈旧楔家（innerAssets 为 null 且 updatedAt
    // 停摆 >60s——抢占后崩溃残留）也进入候选，由 decryptOuterOne 的 60s 接管判定处置；
    // 进行中（<60s）家 updatedAt 新鲜，不落入 OR 第二支，不会被干扰
    const targets = await this.prisma.supplierBidSubmission.findMany({
      where: {
        projectId,
        envelopeVersion: { in: ['dual-v2', 'dual-v3'] },
        OR: [
          { outerDecryptedAt: null },
          { innerAssets: { equals: Prisma.DbNull }, updatedAt: { lt: new Date(Date.now() - 60_000) } },
        ],
      },
      select: { supplierId: true },
    });
    const details: DecryptOuterDetail[] = [];
    for (const target of targets) {
      const bs = await this.prisma.bidSupplier.findFirst({
        where: { projectId, supplierId: target.supplierId, submitStatus: { not: '已撤回' } },
        select: { id: true, supplierName: true },
      });
      if (!bs) continue; // 已撤回/无记录：静默排除，不入明细
      try {
        details.push(await this.decryptOuterOne(projectId, bs.id, actorId));
      } catch (e) {
        const resp = (e as { response?: { error?: string; code?: string } })?.response;
        details.push({
          supplierId: bs.id, supplierName: bs.supplierName, success: false,
          error: resp?.error ?? (e as Error).message, code: resp?.code,
        });
      }
    }
    return {
      total: details.length,
      success: details.filter(d => 'success' in d && d.success === true).length,
      skipped: details.filter(d => 'skipped' in d && d.skipped === true).length,
      failed: details.filter(d => !('success' in d && d.success === true) && !('skipped' in d && d.skipped === true)).length,
      details,
    };
  }

  /** 单家解外层（批量逐家调用的原子单元；项目/会话/窗口门控由 decryptOuter 统一执行） */
  private async decryptOuterOne(projectId: string, bidSupplierId: string, actorId?: string): Promise<DecryptOuterDetail> {
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, id: bidSupplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    const { supplierName } = bidSupplier;
    if (!bidSupplier.supplierId) {
      throw new BadRequestException({ error: '供应商未关联系统账户，无信封提交记录', code: 'NOT_FOUND' });
    }
    const submissionSupplierId: string = bidSupplier.supplierId; // 守卫后收窄为 string，闭包（tx）内同样成立
    const submission = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId: submissionSupplierId, projectId } },
    });
    if (!submission) throw new BadRequestException({ error: '供应商无投标提交记录', code: 'NOT_FOUND' });
    if (submission.envelopeVersion === 'dual-v3') {
      // dual-v3（Task10）：每角色历史 adminCertId + DecryptExecution fence + 版本键对象键
      return this.decryptOuterOneV3(projectId, bidSupplierId, actorId, submission, supplierName);
    }
    if (submission.envelopeVersion !== 'dual-v2') {
      throw new BadRequestException({ error: '该供应商走旧轨（单层）加密，无外层可解', code: 'NOT_DUAL_TRACK' });
    }
    if (submission.outerDecryptedAt && submission.innerAssets !== null) {
      // 已完整解过（innerAssets 已落库）：快路径跳过。outerDecryptedAt 有值但 innerAssets 为
      // null 不在此跳过——那是并发进行中或崩溃残留的楔，交给下方 ① 抢占 + 60s 陈旧接管判定
      return { supplierId: bidSupplierId, supplierName, skipped: true };
    }
    // ── A-109a 签到 quorum 闸门：置于快路径 skip 之后（幂等重解不被 quorum 拦）；
    //    批量路径单家抛错由 decryptOuter 逐家 catch 转明细，不阻塞其余家 ──
    await assertDecryptCheckInQuorum(this.prisma, projectId);
    const envelope = (submission.envelope ?? null) as DualEnvelope | null;
    const roles = (Object.entries(envelope?.files ?? {}) as Array<[EnvelopeRole, EnvelopeFileEntry]>)
      .filter(([, entry]) => !!entry);
    if (!envelope || roles.length === 0) {
      throw new BadRequestException({ error: '信封缺失或为空，无法解外层', code: 'ENVELOPE_MISSING' });
    }

    let adminPrivateKey: string;
    try {
      adminPrivateKey = await this.adminKey.readPrivateKey(envelope.adminCertId);
    } catch {
      throw new BadRequestException({ error: '管理方加密证书私钥不可用（keystore 缺失或未 bootstrap）', code: 'ADMIN_KEY_UNAVAILABLE' });
    }

    // ── ① 原子抢占（同 decryptSupplier phase-① 口径）：并发双击/批量重入只有一笔 count=1，
    //    第二笔返回 skipped——不重复 putObject、不重复建 FileAsset/监督日志 ──
    const claimAt = new Date();
    const claim = await this.prisma.supplierBidSubmission.updateMany({
      where: { supplierId: submissionSupplierId, projectId, outerDecryptedAt: null },
      data: { outerDecryptedAt: claimAt },
    });
    if (claim.count === 0) {
      // ── 陈旧楔接管（同 decryptSupplier 60s 接管口径）：抢占被并发对手拿走，但对手可能在
      //    ② 解密期间崩溃（kill/OOM）——catch 未执行 → outerDecryptedAt 残留、innerAssets 永久
      //    null。此后快路径与抢占都跳过、批量预筛静默剔除，恢复只剩供应商补传或改库。
      //    此处读 submission 判定：innerAssets 为 null 且 updatedAt 停摆超 60s → 条件重占
      //    （带旧 outerDecryptedAt + updatedAt 上限；接管成功的 @updatedAt 刷新使并发第二笔接管 count=0）──
      const fresh = await this.prisma.supplierBidSubmission.findUnique({
        where: { supplierId_projectId: { supplierId: submissionSupplierId, projectId } },
        select: { innerAssets: true, outerDecryptedAt: true, updatedAt: true },
      });
      if (!fresh || fresh.innerAssets !== null || fresh.outerDecryptedAt === null) {
        return { supplierId: bidSupplierId, supplierName, skipped: true }; // 对手进行中（<60s）或已完整落库
      }
      if (fresh.updatedAt >= new Date(Date.now() - 60_000)) {
        return { supplierId: bidSupplierId, supplierName, skipped: true }; // 抢占新鲜：对手仍在解密
      }
      const takeover = await this.prisma.supplierBidSubmission.updateMany({
        where: {
          supplierId: submissionSupplierId, projectId,
          outerDecryptedAt: fresh.outerDecryptedAt, // 只重占这份陈旧标记，防覆盖补传并发重置
          updatedAt: { lt: new Date(Date.now() - 60_000) },
        },
        data: { outerDecryptedAt: claimAt },
      });
      if (takeover.count === 0) {
        return { supplierId: bidSupplierId, supplierName, skipped: true }; // 并发另一笔先重占
      }
      // 重占成功 → 继续 ② 解密流程
    }

    try {
      // ── ② 逐角色：MinIO 读 C_outer → decryptOuterFile → C_inner 写 MinIO（事务外外部 I/O，逐家逐文件串行）──
      const written: Array<{ role: EnvelopeRole; objectKey: string; cInner: Buffer }> = [];
      for (const [role] of roles) {
        const assetId = submission[DUAL_ROLE_ASSET_KEYS[role]] as string | null;
        if (!assetId) {
          throw new BadRequestException({
            error: `信封声明了 ${role} 密封件但提交记录无对应资产引用`, code: 'FILE_RECORD_MISSING',
          });
        }
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
        if (!asset) throw new BadRequestException({ error: `投标文件记录缺失: ${assetId}`, code: 'FILE_RECORD_MISSING' });
        const readKey = asset.sealedPath || asset.key; // 新轨补传后 sealedPath 指新 C_outer（T10 钉死口径）
        const stream = await minioClient.getObject(MINIO_BUCKET, readKey);
        const cOuter = await streamToBuffer(stream);
        const cInner = await this.dualEnvelope.decryptOuterFile(envelope, role, cOuter, adminPrivateKey);
        const objectKey = `bid-inner/${projectId}/${bidSupplierId}/${role}.inner`;
        try {
          await minioClient.putObject(MINIO_BUCKET, objectKey, cInner, cInner.length, {
            'Content-Type': 'application/octet-stream',
          });
        } catch (err) {
          this.logger.error(`decrypt-outer MinIO putObject failed: ${objectKey}`, (err as Error).stack);
          throw new BadRequestException({ error: '文件存储失败，请重试', code: 'STORAGE_FAILED' });
        }
        written.push({ role, objectKey, cInner });
      }

      // ── ③ 短事务终局：C_inner 资产落库（归属链）+ 监督日志 + 审计
      //    （outerDecryptedAt 已由 ① 抢占写入，此处只补 innerAssets）──
      const innerAssets: Record<string, string> = {};
      const doneAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        for (const w of written) {
          const asset = await tx.fileAsset.create({
            data: {
              key: w.objectKey,
              originalName: `${w.role}.inner`,
              mimeType: 'application/octet-stream',
              size: w.cInner.length,
              sha256: await sha256Hex(w.cInner),
              category: 'bid_inner_ciphertext',
              clientEncrypted: false, // 服务端写入的中间密文（非客户端直传产物）——Task 12 契约
              encrypted: true,
              uploaderId: actorId ?? null,
            },
          });
          innerAssets[w.role] = asset.id;
        }
        await tx.supplierBidSubmission.update({
          where: { supplierId_projectId: { supplierId: submissionSupplierId, projectId } },
          data: { innerAssets: innerAssets as unknown as Prisma.InputJsonValue },
        });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: doneAt, role: '开标主持人', target: supplierName, action: '管理方解外层',
            result: `${written.length} 个角色密封件解外层完成（C_inner 已归属，开标前仍不可读）`, riskFlag: '无',
          },
        });
        if (actorId) {
          await tx.auditLog.create({
            data: {
              userId: actorId, action: 'BID_DECRYPT_OUTER', resourceType: `BidSupplier:${bidSupplierId}`,
              details: { projectId, roles: written.map(w => w.role), innerAssets },
            },
          });
        }
      });

      // 事务提交后广播（失败不回滚假通知，同 decryptSupplier 模式）
      this.gateway?.notifySupervisionLog(projectId, {
        role: '开标主持人', action: '管理方解外层', target: supplierName,
        result: `${written.length} 个角色密封件解外层完成（C_inner 已归属，开标前仍不可读）`, riskFlag: '无',
      });

      return {
        supplierId: bidSupplierId, supplierName, success: true,
        roles: written.map(w => w.role), innerAssets,
      };
    } catch (e) {
      // 失败回滚抢占（条件更新 outerDecryptedAt=claimAt 防覆盖并发补传的重置）：
      // 复原 null 后可直接重试，无需供应商走补传通道
      await this.prisma.supplierBidSubmission.updateMany({
        where: { supplierId: submissionSupplierId, projectId, outerDecryptedAt: claimAt },
        data: { outerDecryptedAt: null },
      }).catch(() => {});
      throw e;
    }
  }

  /**
   * dual-v3（Task10，附录 §5.D）：主持端解外层 v3 分支。
   * 与 v2 的差异：
   *  - 信封唯一事实源=SubmissionVersion 冻结快照（submission.envelope 仅冗余展示）
   *  - 每角色独立 kadmin.adminCertId（管理方证书轮转后，历史版本信封仍可解——不再顶层一次）
   *  - C_outer 完整性闸：读出密文 sha256 == 信封声明 outerSha256（暂存件调包检测）
   *  - DecryptExecution 槽位（submissionId+revision+phase 唯一）fence CAS：每次尝试 fence+1，
   *    终局写须持有本 attempt 的 fence——旧 attempt 晚到不得覆盖新 attempt 的终局
   *  - 对象键含 revision+attempt：`bid-inner/{projectId}/{bidSupplierId}/{role}.{revision}.{attempt}.inner`
   */
  private async decryptOuterOneV3(
    projectId: string,
    bidSupplierId: string,
    actorId: string | undefined,
    submission: { id: string; supplierId: string; revision: number; outerDecryptedAt: Date | null; innerAssets: unknown },
    supplierName: string,
  ): Promise<DecryptOuterDetail> {
    const versionRow = await this.prisma.submissionVersion.findUnique({
      where: { submissionId_revision: { submissionId: submission.id, revision: submission.revision } },
    });
    if (!versionRow) {
      throw new BadRequestException({ error: '版本快照缺失，无法解外层', code: 'VERSION_SNAPSHOT_MISSING' });
    }
    const env = versionRow.envelope as unknown as DualV3Envelope;
    const roles = (Object.entries(env.files ?? {}) as Array<[EnvelopeRole, DualV3FileEntry]>)
      .filter(([, entry]) => !!entry);
    if (roles.length === 0) {
      throw new BadRequestException({ error: '信封缺失或为空，无法解外层', code: 'ENVELOPE_MISSING' });
    }
    if (submission.outerDecryptedAt && submission.innerAssets !== null) {
      return { supplierId: bidSupplierId, supplierName, skipped: true };
    }
    await assertDecryptCheckInQuorum(this.prisma, projectId);

    // ── DecryptExecution 槽位（fence 每尝试 +1；attempt=fence 序号入对象键）──
    const leaseUntil = new Date(Date.now() + 120_000);
    const slot = await this.prisma.decryptExecution.upsert({
      where: { submissionId_revision_phase: { submissionId: submission.id, revision: submission.revision, phase: 'outer' } },
      create: {
        submissionId: submission.id, revision: submission.revision, phase: 'outer',
        attemptId: randomUUID(), fence: 1, leaseUntil, status: 'RUNNING',
      },
      update: { fence: { increment: 1 }, attemptId: randomUUID(), leaseUntil, status: 'RUNNING' },
    });
    const attempt = slot.fence;

    // ── outerDecryptedAt 抢占（v2 同款互斥；v3 叠加 fence 管版本内多 attempt 隔离）──
    const claimAt = new Date();
    const claim = await this.prisma.supplierBidSubmission.updateMany({
      where: { supplierId: submission.supplierId, projectId, outerDecryptedAt: null },
      data: { outerDecryptedAt: claimAt },
    });
    if (claim.count === 0) {
      const fresh = await this.prisma.supplierBidSubmission.findUnique({
        where: { supplierId_projectId: { supplierId: submission.supplierId, projectId } },
        select: { innerAssets: true, outerDecryptedAt: true, updatedAt: true },
      });
      if (!fresh || fresh.innerAssets !== null || fresh.outerDecryptedAt === null
        || fresh.updatedAt >= new Date(Date.now() - 60_000)) {
        return { supplierId: bidSupplierId, supplierName, skipped: true };
      }
      const takeover = await this.prisma.supplierBidSubmission.updateMany({
        where: {
          supplierId: submission.supplierId, projectId,
          outerDecryptedAt: fresh.outerDecryptedAt,
          updatedAt: { lt: new Date(Date.now() - 60_000) },
        },
        data: { outerDecryptedAt: claimAt },
      });
      if (takeover.count === 0) {
        return { supplierId: bidSupplierId, supplierName, skipped: true };
      }
    }

    try {
      // ── 逐角色：C_outer 读取（entry.assetId=暂存件）→ outerSha256 闸 → 每角色私钥 → 剥外层 ──
      const written: Array<{ role: EnvelopeRole; objectKey: string; cInner: Buffer }> = [];
      for (const [role, entry] of roles) {
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: entry.assetId } });
        if (!asset) throw new BadRequestException({ error: `投标文件记录缺失: ${entry.assetId}`, code: 'FILE_RECORD_MISSING' });
        const readKey = asset.sealedPath || asset.key;
        const cOuter = await streamToBuffer(await minioClient.getObject(MINIO_BUCKET, readKey));
        if ((await sha256Hex(cOuter)) !== entry.outerSha256) {
          throw new BadRequestException({ error: `${role} 外层密文哈希与信封声明不符（疑似暂存件被调包）`, code: 'OUTER_HASH_MISMATCH' });
        }
        let adminPrivateKey: string;
        try {
          adminPrivateKey = await this.adminKey.readPrivateKey(entry.kadmin.adminCertId);
        } catch {
          throw new BadRequestException({ error: '管理方加密证书私钥不可用（keystore 缺失或未 bootstrap）', code: 'ADMIN_KEY_UNAVAILABLE' });
        }
        const cInner = await this.dualEnvelope.decryptOuterFileV3(entry, cOuter, adminPrivateKey);
        const objectKey = `bid-inner/${projectId}/${bidSupplierId}/${role}.${submission.revision}.${attempt}.inner`;
        try {
          await minioClient.putObject(MINIO_BUCKET, objectKey, cInner, cInner.length, {
            'Content-Type': 'application/octet-stream',
          });
        } catch (err) {
          this.logger.error(`decrypt-outer-v3 MinIO putObject failed: ${objectKey}`, (err as Error).stack);
          throw new BadRequestException({ error: '文件存储失败，请重试', code: 'STORAGE_FAILED' });
        }
        written.push({ role, objectKey, cInner });
      }

      // ── 短事务终局：fence CAS（旧 attempt 不得写终局）→ C_inner 归属链 + 监督日志 + 审计 ──
      const innerAssets: Record<string, string> = {};
      const doneAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        const fenceClaim = await tx.decryptExecution.updateMany({
          where: { id: slot.id, fence: attempt, status: { not: 'SUCCESS' } },
          data: { status: 'SUCCESS' },
        });
        if (fenceClaim.count === 0) {
          throw new ConflictException({ error: '解外层尝试已被新尝试接管，本次产物作废', code: 'STALE_ATTEMPT' });
        }
        for (const w of written) {
          const asset = await tx.fileAsset.create({
            data: {
              key: w.objectKey,
              originalName: `${w.role}.inner`,
              mimeType: 'application/octet-stream',
              size: w.cInner.length,
              sha256: await sha256Hex(w.cInner),
              category: 'bid_inner_ciphertext',
              clientEncrypted: false,
              encrypted: true,
              uploaderId: actorId ?? null,
            },
          });
          innerAssets[w.role] = asset.id;
        }
        await tx.supplierBidSubmission.update({
          where: { supplierId_projectId: { supplierId: submission.supplierId, projectId } },
          data: { innerAssets: innerAssets as unknown as Prisma.InputJsonValue },
        });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: doneAt, role: '开标主持人', target: supplierName, action: '管理方解外层（v3）',
            result: `${written.length} 个角色密封件解外层完成（revision=${submission.revision} attempt=${attempt}，C_inner 已归属，开标前仍不可读）`, riskFlag: '无',
          },
        });
        if (actorId) {
          await tx.auditLog.create({
            data: {
              userId: actorId, action: 'BID_DECRYPT_OUTER_V3', resourceType: `BidSupplier:${bidSupplierId}`,
              details: { projectId, revision: submission.revision, attempt, roles: written.map(w => w.role), innerAssets },
            },
          });
        }
      });

      this.gateway?.notifySupervisionLog(projectId, {
        role: '开标主持人', action: '管理方解外层（v3）', target: supplierName,
        result: `${written.length} 个角色密封件解外层完成（revision=${submission.revision} attempt=${attempt}）`, riskFlag: '无',
      });

      return {
        supplierId: bidSupplierId, supplierName, success: true,
        roles: written.map(w => w.role), innerAssets,
      };
    } catch (e) {
      // 槽位标 FAILED（仅当仍持有本 attempt 的 fence——勿覆盖新 attempt 状态）
      await this.prisma.decryptExecution.updateMany({
        where: { id: slot.id, fence: attempt },
        data: { status: 'FAILED' },
      }).catch(() => {});
      // 失败回滚 outerDecryptedAt（条件更新防覆盖并发补传重置），复原 null 后可直接重试
      await this.prisma.supplierBidSubmission.updateMany({
        where: { supplierId: submission.supplierId, projectId, outerDecryptedAt: claimAt },
        data: { outerDecryptedAt: null },
      }).catch(() => {});
      throw e;
    }
  }

  async adjudicateDecryptFault(
    projectId: string,
    supplierId: string,
    attribution: 'BIDDER' | 'PLATFORM' | 'RESET_PENDING',
    reason: string,
    actorId?: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException({ error: '裁决原因必填（写入监督日志与审计）', code: 'REASON_REQUIRED' });
    }
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '仅开标阶段可裁决解密失败归因', code: 'PROJECT_NOT_OPENING' });
    }
    // 惰性归因先跑一次（幂等）：主持端直接从待裁决清单进入时，UNKNOWN 标记可能尚未落库
    await this.bidService.attributePendingDualSuppliers(projectId);

    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, id: supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    const { supplierName } = bidSupplier;
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId }, select: { decryptWindowEnd: true },
    });
    const windowOpen = !!session?.decryptWindowEnd && session.decryptWindowEnd.getTime() > Date.now();

    if (attribution === 'RESET_PENDING') {
      if (!windowOpen) {
        throw new ConflictException({ error: '解密窗口已关闭，请先延长解密窗口再重置解密机会', code: 'DECRYPT_WINDOW_CLOSED' });
      }
      const isDanger = bidSupplier.decryptStatus === 'DANGER' && bidSupplier.dangerAttribution !== 'BIDDER';
      const isUnknownPending = bidSupplier.decryptStatus === 'PENDING' && bidSupplier.dangerAttribution === 'UNKNOWN';
      if (!isDanger && !isUnknownPending) {
        throw new BadRequestException({ error: '仅解密异常（DANGER）或待裁决（UNKNOWN）供应商可重置解密机会', code: 'NOT_RESETTABLE' });
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.bidSupplier.update({
          where: { id: supplierId },
          data: { decryptStatus: 'PENDING', decryptError: null, dangerAttribution: null, decryptedAt: null },
        });
        await tx.bidSupervisionLog.create({
          data: {
            projectId, time: new Date(), role: '开标主持人', target: supplierName,
            action: '重置解密机会', result: `重置为 PENDING（解密窗口内可重试）：${reason}`, riskFlag: '中',
          },
        });
        if (actorId) {
          await tx.auditLog.create({
            data: { userId: actorId, action: 'BID_DECRYPT_ADJUDGE', resourceType: `${supplierName}:${supplierId}`, details: { projectId, attribution, reason } },
          });
        }
      });
      if (bidSupplier.supplierId) notifySupplierDecryptAttribution(this.prisma, this.notificationService, bidSupplier.supplierId, supplierName, projectId, 'RESET_PENDING');
      return { adjudged: true, supplierId, supplierName, attribution };
    }

    // BIDDER / PLATFORM 终局裁决
    // 纠错通道：已归因 BIDDER 的 DANGER 家允许改判 PLATFORM（撤销判定更正为撤回）；
    // BIDDER→RESET_PENDING 仍拒绝（见上 RESET_PENDING 分支，视为撤销不可逆）。
    const isRejudge = bidSupplier.dangerAttribution === 'BIDDER'
      && bidSupplier.decryptStatus === 'DANGER'
      && attribution === 'PLATFORM';
    if (bidSupplier.dangerAttribution !== 'UNKNOWN' && !isRejudge) {
      throw new BadRequestException({
        error: bidSupplier.dangerAttribution
          ? `该供应商已归因（${bidSupplier.dangerAttribution}），无需重复裁决`
          : '该供应商无待裁决归因（仅 UNKNOWN 家可裁决）',
        code: 'NOT_UNKNOWN',
      });
    }
    const RESULT_TEXT = {
      BIDDER: '归因判定：BIDDER——因投标人原因未完成解密，视为撤销投标文件',
      PLATFORM: '归因判定：PLATFORM——因平台原因未完成解密，视为撤回投标文件',
    } as const;
    await this.prisma.$transaction(async (tx) => {
      // 已 DANGER（双闸失败家/改判家）仅落归因；PENDING 家同时落终局态。
      // Task 15 顺带 Minor：改判（BIDDER→PLATFORM）时同步改写 decryptError，消除与归因字段矛盾的「投标人过错」残留文案
      const data: Prisma.BidSupplierUpdateInput = bidSupplier.decryptStatus === 'DANGER'
        ? (isRejudge
            ? { dangerAttribution: attribution, decryptError: `归因改判（PLATFORM）：${reason}` }
            : { dangerAttribution: attribution })
        : { decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', decryptError: `归因裁决（${attribution}）：${reason}`, dangerAttribution: attribution };
      await tx.bidSupplier.update({ where: { id: supplierId }, data });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: supplierName,
          action: '解密失败归因裁决',
          result: isRejudge
            ? `归因改判：BIDDER→PLATFORM——因平台原因未完成解密，视为撤回投标文件（原因：${reason}）`
            : `${RESULT_TEXT[attribution]}（原因：${reason}）`,
          riskFlag: '高风险',
        },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: {
            userId: actorId, action: 'BID_DECRYPT_ADJUDGE', resourceType: `${supplierName}:${supplierId}`,
            details: isRejudge ? { projectId, attribution, reason, rejudgedFrom: 'BIDDER' } : { projectId, attribution, reason },
          },
        });
      }
    });
    this.gateway?.notifyDecryptStatus(projectId, supplierId, supplierName, 'DANGER');
    if (bidSupplier.supplierId) notifySupplierDecryptAttribution(this.prisma, this.notificationService, bidSupplier.supplierId, supplierName, projectId, attribution);
    // 终局即固化（A）：归因裁决为终局态写入，若全体已终局则自动固化开标文件包（幂等、不阻塞）
    void this.bidService.autoHandoverIfDone(projectId, '解密归因裁决');
    return { adjudged: true, supplierId, supplierName, attribution };
  }

  /**
   * 主持人显式确认接受供应商解密失败（不可恢复），将供应商标记为 EXCEPTION 终局态。
   * 仅 OPENING 阶段、decryptStatus=DANGER 时可调用。
   */
  async acceptSupplierDanger(projectId: string, supplierId: string, reason: string, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '仅开标阶段可操作', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, id: supplierId },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    // P1-1：解密窗口到期后允许对 PENDING/RUNNING 未解密供应商定性——否则三面卡死
    // （解密 403 DECRYPT_WINDOW_CLOSED / 本端点 400 / completeOpening 409 OPENING_NOT_DONE），
    // 唯一出路「重新组建会话延长窗口」无任何提示。窗口未过期时仍仅 DANGER 可定性。
    const session = await this.prisma.bidOpeningSession.findUnique({
      where: { projectId },
      select: { decryptWindowEnd: true },
    });
    const windowExpired = !session || session.decryptWindowEnd.getTime() <= Date.now();
    const undecrypted = bidSupplier.decryptStatus === 'PENDING' || bidSupplier.decryptStatus === 'RUNNING';
    if (bidSupplier.decryptStatus !== 'DANGER' && !(windowExpired && undecrypted)) {
      throw new BadRequestException({ error: '仅解密异常（DANGER）状态的供应商可确认接受', code: 'NOT_DANGER' });
    }

    const finalReason = windowExpired && undecrypted
      ? `解密窗口已过期未解密：${reason}`
      : (bidSupplier.decryptError || reason);

    await this.prisma.$transaction(async (tx) => {
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', decryptError: finalReason },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: bidSupplier.supplierName,
          action: '确认接受解密失败', result: windowExpired && undecrypted ? finalReason : reason, riskFlag: '高风险',
        },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_ACCEPT_DANGER', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, reason } },
        });
      }
    });

    this.gateway?.notifySupervisionLog(projectId, {
      role: '开标主持人', action: '确认接受解密失败', target: bidSupplier.supplierName,
      result: windowExpired && undecrypted ? finalReason : reason, riskFlag: '高风险',
    });

    // 终局即固化（A）：接受解密失败为终局态，若全体已终局则自动固化开标文件包（幂等、不阻塞）
    void this.bidService.autoHandoverIfDone(projectId, '主持人接受解密失败');

    return { accepted: true, supplierId, supplierName: bidSupplier.supplierName };
  }
}
