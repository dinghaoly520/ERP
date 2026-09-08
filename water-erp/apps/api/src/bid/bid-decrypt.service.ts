/** 双信封解密域（F1d）——自 bid.service.ts 迁出（P1 审查 F 簇拆分，纯移动；保密核心，零逻辑触碰）。索引：decryptOuter/decryptAllSuppliers/decryptSupplier/adjudicateDecryptFault/acceptSupplierDanger/reuploadBidFile/resealBidFiles/reloadTenderDocument（+私有 decryptOuterOne/notifySupplierDecryptFailure） */
import { Injectable, BadRequestException, ConflictException, ForbiddenException, Optional, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { BidService } from './bid.service'; // 值导入：emitDecoratorMetadata 需运行时引用，import type 会退化为 Object 致 DI 失败
import { assertPriceMatchesSealed, assertPeriodMatchesSubmitted } from './opening-record-assert.util';
import { notifySupplierDecryptAttribution } from './decrypt-notify.util';
import { DecryptSupplierDto } from './dto/decrypt-supplier.dto';
import { assertDecryptCheckInQuorum } from './decrypt-quorum.util';
import { encryptBuffer, decryptBuffer, streamToBuffer, verifyIntegrity, classifyDecryptOutcome } from './bid-submission.crypto';
import { wrapKey, unwrapKey, isWrappedKey } from '../common/crypto/envelope-crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { Prisma } from '@prisma/client';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { sha256Hex } from '@water-erp/ukey';
import type { DualEnvelope, EnvelopeFileEntry, EnvelopeRole } from '@water-erp/ukey';

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
        envelopeVersion: 'dual-v2',
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
   * 4.4: 一键解密窗口内所有待解密供应商
   */
  async decryptAllSuppliers(projectId: string, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { stage: true, name: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段', code: 'PROJECT_NOT_OPENING' });
    }

    // N15：只取 PENDING——已定性 DANGER（人工判定为异常）不重跑，避免一键解密把它们必然计 failed；
    // 恢复路径不变：补传通道 reuploadBidFile 会把 DANGER 重置为 PENDING 后再解密
    const pendingSuppliers = await this.prisma.bidSupplier.findMany({
      where: { projectId, decryptStatus: 'PENDING', submitStatus: { not: '已撤回' } },
      select: { id: true, supplierName: true, supplierId: true },
    });

    // Task 16 旧轨收窄：待解名单预查 submissions，dual-v2 家 skip 不入解密循环
    // （新轨解密走 supplier-portal；旧轨端点对 dual-v2 会 400，预过滤避免把 400 计成 failed 噪音）
    const supplierIds = pendingSuppliers.map(s => s.supplierId).filter((v): v is string => !!v);
    const dualV2SupplierIds = new Set<string>();
    if (supplierIds.length > 0) {
      const subs = await this.prisma.supplierBidSubmission.findMany({
        where: { projectId, supplierId: { in: supplierIds } },
        select: { supplierId: true, envelopeVersion: true },
      });
      for (const sub of subs) {
        if (sub.envelopeVersion === 'dual-v2') dualV2SupplierIds.add(sub.supplierId);
      }
    }

    const results: Array<{ supplierId: string; supplierName: string; success: boolean; error?: string }> = [];
    for (const s of pendingSuppliers) {
      if (s.supplierId && dualV2SupplierIds.has(s.supplierId)) {
        results.push({ supplierId: s.id, supplierName: s.supplierName, success: false, error: '新轨项目请走供应商解密' });
        continue;
      }
      try {
        await this.decryptSupplier(projectId, s.id, undefined, actorId);
        results.push({ supplierId: s.id, supplierName: s.supplierName, success: true });
      } catch (e) {
        results.push({ supplierId: s.id, supplierName: s.supplierName, success: false, error: (e as Error).message });
      }
    }

    this.gateway?.notifySupervisionLog(projectId, {
      role: '系统', action: '一键解密', target: project.name,
      result: `${results.filter(r => r.success).length}/${results.length} 成功（已定性异常者请走补传→重解密通道）`, riskFlag: '无',
    });

    return { total: results.length, success: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, details: results };
  }

  async decryptSupplier(projectId: string, supplierId: string, dto?: DecryptSupplierDto, actorId?: string) {
    // ═══ P1-3 三段式重构 ═══
    // 旧实现整段包在 $transaction 内：MinIO 读流/AES 解密等外部 I/O 长占连接（pgbouncer 池风险）、
    // WS 事件事务内发射（回滚后客户端已收到假成功）、无行锁（并发双击双跑+重复建开标记录）。
    // 新结构：①事务外校验+原子抢占 → ②事务外解密(外部 I/O) → ③短事务终局写入，WS 全部后置。

    // ── ① 校验 + 原子抢占（updateMany 条件更新即抢占，并发双击只有一方 count=1）──
    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, id: supplierId },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    // P0: 重复解密保护 — 已成功解密的不允许再次解密（避免覆写 confirmStatus）
    if (bidSupplier.decryptStatus === 'SUCCESS') {
      throw new BadRequestException({ error: '标书已解密成功，无需重复解密', code: 'ALREADY_DECRYPTED' });
    }
    // P0: 显式阶段门控 — 仅 OPENING 阶段可解密（兜底 session 校验）
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法解密', code: 'PROJECT_NOT_OPENING' });
    }
    // P0: 解密窗口校验 — 开标未启动或窗口未开启/已关闭/暂停中时拒绝解密
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

    // ── Task 16 旧轨收窄：dual-v2 家走供应商解密（supplier-portal 新轨），旧轨端点 400 ──
    // 只读门控必须置于 phase-① 原子抢占之前：抢占成功后再 400 会留 RUNNING 楔（60s 接管才可重试）。
    if (bidSupplier.supplierId) {
      const envelopeSubmission = await this.prisma.supplierBidSubmission.findUnique({
        where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        select: { envelopeVersion: true },
      });
      if (envelopeSubmission?.envelopeVersion === 'dual-v2') {
        throw new BadRequestException({ error: '新轨项目请走供应商解密', code: 'USE_SUPPLIER_DECRYPT' });
      }
    }

    // ── P1-4：解密即唱标路径——mismatch 断言前置于 phase-① 抢占（2026-08-17 fix round 2）──
    // 409 若在 phase-③ 事务内抛出 → 回滚后 decryptStatus 已抢为 RUNNING（@updatedAt 刚刷新），确认重试
    // 60s 内撞 claim 判 DECRYPT_ALREADY_IN_FLIGHT。两个断言均为只读（各自 fetch bidSupplier+submission），
    // 前置安全：409 时供应商仍 PENDING 重试即时生效，还省一次不必要解密。
    let decryptPriceNote: string | null = null;
    let decryptPeriodNote: string | null = null;
    if (dto?.amount && dto?.period && dto?.qualityTarget && dto?.bondStatus) {
      decryptPriceNote = await assertPriceMatchesSealed(this.prisma, projectId, supplierId, dto.amount, dto.confirmSealedPrice);
      decryptPeriodNote = await assertPeriodMatchesSubmitted(this.prisma, projectId, supplierId, dto.period, dto.confirmSealedPeriod);
    }

    // Phase 1: 原子抢占（PENDING→RUNNING；并发第二笔 count=0）。
    // N1 修复：旧 where 含 RUNNING → RUNNING→RUNNING 的 no-op 更新同样 count=1，互斥失效、双击双跑。
    const claim = await this.prisma.bidSupplier.updateMany({
      where: { id: supplierId, decryptStatus: 'PENDING' },
      data: { decryptStatus: 'RUNNING' },
    });
    if (claim.count === 0) {
      const fresh = await this.prisma.bidSupplier.findUnique({
        where: { id: supplierId },
        select: { decryptStatus: true, updatedAt: true },
      });
      if (fresh?.decryptStatus === 'SUCCESS') {
        throw new BadRequestException({ error: '标书已解密成功，无需重复解密', code: 'ALREADY_DECRYPTED' });
      }
      if (fresh?.decryptStatus === 'RUNNING') {
        // 崩溃接管：RUNNING 停滞超 60s（进程崩溃/外部 IO 卡死遗留）方可重占。
        // 条件更新带 updatedAt 上限：接管成功的 @updatedAt 刷新使并发第二笔接管 count=0。
        const takeover = await this.prisma.bidSupplier.updateMany({
          where: { id: supplierId, decryptStatus: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 60_000) } },
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

    // ── ② 事务外解密（MinIO 读流 + AES + SHA-256，不占 DB 连接）──
    // 查找该供应商的提交记录（含加密封存密钥与文件引用）
    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        })
      : null;

    // 真实解密 + 完整性校验（如有文件引用）：读取 MinIO 文件，重算 SHA-256 与 FileAsset.sha256 比对；
    // 若存在 sealedKey 则先做真实 AES-256-GCM 解密。DANGER 由真实校验失败触发，不再依赖 simulateDanger。
    let decryptOk: boolean | null = null;
    let integrityOk: boolean | null = null;
    let errorMsg = '';
    let allFilesOk = true; // H1: 任一文件缺失/解密失败/完整性失败 → 整体失败，杜绝部分缺失误判 SUCCESS

    const fileRefs: Array<{ assetId?: string | null; sealedKey?: string | null }> = submission
      ? [
          { assetId: submission.technicalFileAssetId, sealedKey: submission.technicalSealedKey },
          { assetId: submission.businessFileAssetId, sealedKey: submission.businessSealedKey },
          { assetId: submission.coverLetterAssetId, sealedKey: submission.coverLetterSealedKey },
        ].filter(ref => !!ref.assetId)
      : [];

    if (fileRefs.length > 0) {
      for (const ref of fileRefs) {
        if (!ref.assetId) continue;
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: ref.assetId } });
        if (!asset) { allFilesOk = false; errorMsg = `投标文件记录缺失: ${ref.assetId}`; break; }
        try {
          const readKey = asset.sealedPath || asset.key; // 兼容存量：无 sealedPath 时回退到原路径
          const objStream = await minioClient.getObject(MINIO_BUCKET, readKey);
          let buffer = await streamToBuffer(objStream);
          // Layer B：有 sealedKey 时执行真实 AES 解密
          if (ref.sealedKey) {
            const rawKey = isWrappedKey(ref.sealedKey)
              ? unwrapKey(ref.sealedKey, process.env.KMS_SECRET!)
              : ref.sealedKey;
            buffer = decryptBuffer(buffer, rawKey);
            decryptOk = true;
          }
          // Layer A：完整性校验（解密后的明文 vs 存储 sha256）
          const integrity = verifyIntegrity(buffer, asset.sha256);
          if (integrity === false) { allFilesOk = false; integrityOk = false; errorMsg = '标书文件完整性校验失败：SHA-256 不匹配（疑似篡改或损坏）'; break; }
          if (integrity === true) integrityOk = true;
        } catch (e) {
          allFilesOk = false;
          decryptOk = ref.sealedKey ? false : null;
          errorMsg = `标书文件解密失败：${(e as Error).message}`;
          break;
        }
      }
    }

    const hasSealedKey = !!submission && !!(submission.technicalSealedKey || submission.businessSealedKey || submission.coverLetterSealedKey);
    // P0 Security: simulateDanger is gated to non-production environments only.
    // In production, any attempt to force DANGER is rejected with an explicit error.
    const simulateOk = dto?.simulateDanger === true;
    if (simulateOk && process.env.NODE_ENV === 'production') {
      throw new BadRequestException({ error: 'simulateDanger 不可在生产环境使用', code: 'FORBIDDEN_IN_PRODUCTION' });
    }
    // P0: 无投标文件 → 直接标记 DANGER，避免 classifyDecryptOutcome 默认判 SUCCESS
    const noFiles = fileRefs.length === 0;
    const outcome = simulateOk
      ? 'DANGER' as const  // 仅非生产环境可用：显式模拟开关用于演练（覆盖真实结果）
      : (noFiles || !allFilesOk
          ? 'DANGER' as const  // H1: 任一文件缺失/解密失败/完整性失败 → 整体 DANGER
          : classifyDecryptOutcome({ hasSealedKey, decryptOk, integrityOk }));
    const dangerReason = noFiles
      ? (submission
          ? '投标文件引用缺失（未上传技术/商务/报价文件）'
          : (bidSupplier.supplierId ? '供应商未提交投标文件' : '供应商未关联系统账户，无法查询投标记录'))
      : (errorMsg || '标书文件校验失败：签名不匹配或文件损坏');

    // ── ③ 短事务终局写入（DB 状态+记录+日志+审计；WS 事件事务提交后统一发射）──
    let finalState: any = null;
    await this.prisma.$transaction(async (tx) => {
      if (outcome === 'DANGER') {
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION', decryptError: dangerReason, dangerAttribution: 'PLATFORM' } });
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密异常：${dangerReason}`, riskFlag: '高风险' },
        });
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'DANGER', reason: dangerReason, phase: noFiles ? 'no_files' : 'decrypt_verify' } } });
      } else {
        await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'SUCCESS', decryptedAt: new Date() } });
        // 创建开标记录（仅当开标记录字段全部提供时）——等待供应商确认，不自动 CONFIRMED。
        // P1-3/N1b：upsert（projectId+bidSupplierId 复合唯一兜底），消除并发双击重复建记录。
        if (dto?.amount && dto?.period && dto?.qualityTarget && dto?.bondStatus) {
          // P1-4：mismatch 断言已前置于 phase-① 抢占（见上）——此处仅消费预计算 note 落监督日志
          if (decryptPriceNote || decryptPeriodNote) {
            await tx.bidSupervisionLog.create({
              data: { projectId, time: new Date(), role: '开标主持人', target: bidSupplier.supplierName, action: '录入唱标信息', result: `报价 ${dto.amount} / 工期 ${dto.period}${decryptPriceNote ?? ''}${decryptPeriodNote ?? ''}`, riskFlag: '中' },
            });
          }
          const recordData = {
            supplierName: bidSupplier.supplierName,
            amount: dto.amount,
            period: dto.period,
            qualityTarget: dto.qualityTarget,
            bondStatus: dto.bondStatus,
            decryptResult: '解密成功',
            confirmStatus: '待供应商确认',
          };
          await tx.bidOpeningRecord.upsert({
            where: { projectId_bidSupplierId: { projectId, bidSupplierId: supplierId } },
            create: { projectId, ...recordData, bidSupplierId: supplierId },
            update: recordData,
          });
        }
        const legacyNote = hasSealedKey ? '' : '（legacy 记录：未加密封存，仅完成完整性校验）';
        await tx.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '系统', target: bidSupplier.supplierName, action: '标书解密', result: `解密成功，等待供应商确认唱标信息${legacyNote}`, riskFlag: '无' },
        });
        if (actorId) await tx.auditLog.create({ data: { userId: actorId, action: 'BID_DECRYPT', resourceType: `${bidSupplier.supplierName}:${supplierId}`, details: { projectId, outcome: 'SUCCESS' } } });
      }
      finalState = await tx.bidSupplier.update({ where: { id: supplierId }, data: { confirmStatus: outcome === 'DANGER' ? 'EXCEPTION' : 'PENDING' } });
    });

    // WS 事件事务提交后发射（失败不回滚假通知）；供应商失败通知 fire-and-forget
    if (outcome === 'DANGER') {
      this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'DANGER');
      this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密异常：${dangerReason}`, riskFlag: '高风险' });
      this.gateway?.notifyAnomaly(projectId, { type: 'decrypt_failure', supplierId, supplierName: bidSupplier.supplierName, detail: dangerReason, severity: 'danger' });
      this.notifySupplierDecryptFailure(bidSupplier.supplierId, bidSupplier.supplierName, projectId, dangerReason);
    } else {
      this.gateway?.notifyDecryptStatus(projectId, supplierId, bidSupplier.supplierName, 'SUCCESS');
      const legacyNote2 = hasSealedKey ? '' : '（legacy 记录：未加密封存，仅完成完整性校验）';
      this.gateway?.notifySupervisionLog(projectId, { role: '系统', action: '标书解密', target: bidSupplier.supplierName, result: `解密成功，等待供应商确认唱标信息${legacyNote2}`, riskFlag: '无' });
    }

    // 终局即固化（A）：解密异常定性为终局态，若全体已终局则自动固化开标文件包（幂等、不阻塞）
    void this.bidService.autoHandoverIfDone(projectId, '主持端解密归因');

    return finalState;
  }

  /**
   * 向供应商发送解密失败通知（fire-and-forget，不阻塞解密主流程）。
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
        select: { userId: true, name: true },
      });
      if (supplier?.userId) {
        await this.notificationService.sendToUser(supplier.userId, ['in_app'], {
          type: 'BID_DECRYPT_FAILED',
          title: `投标文件解密异常：${supplierName}`,
          content: `您在项目中的投标文件解密失败：${reason}。因平台原因未完成解密，视为撤回投标文件，你有权要求责任方赔偿因此遭受的直接损失（《电子招标投标办法》第31条）。`,
          link: `/my-bids/${projectId}/opening-hall`,
        });
      }
    } catch {
      /* 通知失败不阻塞解密流程 */
    }
  }

  /**
   * 解密失败归因裁决（§5.5 主持人处置，POST projects/:id/opening/decrypt-adjudge）：
   * - BIDDER / PLATFORM：UNKNOWN 家落终局 DANGER+EXCEPTION（已 DANGER 家仅落归因），
   *   通知文案按归因分流并告知权利（BIDDER 撤销款 / PLATFORM 赔偿请求权，办法第31条）；
   * - RESET_PENDING（T13 硬前置）：DANGER/UNKNOWN 家重置解密机会（窗口须开，否则 409 需先延长窗口），
   *   并站内信通知供应商重新解密。
   * reason 必填：写监督日志 + auditLog。
   */
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

  /**
   * 管理员补传异常投标文件（兜底机制）。
   * SHA-256 闸门：上传文件必须与原始标书逐字节一致（FileAsset.sha256），拒绝替换。
   * 重新加密 → 覆盖 sealedPath/sealedKey → 重置 DANGER → 自动重解密。
   * 仅 OPENING 阶段允许（评标开始后锁死）。
   */
  async reuploadBidFile(
    projectId: string,
    supplierId: string,
    role: string,
    file: Express.Multer.File,
    actorId: string,
  ) {
    // ── 角色字段映射 ──
    const ROLE_MAP = {
      technical:   { assetIdKey: 'technicalFileAssetId',  sealedKeyKey: 'technicalSealedKey'  },
      business:    { assetIdKey: 'businessFileAssetId',   sealedKeyKey: 'businessSealedKey'   },
      coverLetter: { assetIdKey: 'coverLetterAssetId',    sealedKeyKey: 'coverLetterSealedKey'},
    } as const;
    const fields = ROLE_MAP[role as keyof typeof ROLE_MAP];
    if (!fields) throw new BadRequestException({ error: '无效文件角色', code: 'INVALID_ROLE' });

    // ── 阶段门：仅 OPENING ──
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ForbiddenException({ error: '仅开标阶段可补传投标文件', code: 'STAGE_NOT_OPENING' });
    }

    // ── 查 BidSupplier → SupplierBidSubmission → FileAsset ──
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, id: supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });

    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        })
      : null;
    if (!submission) throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });

    // ── 新轨分派（Task 10）：dual-v2 的 C_outer 是客户端双层加密产物（SM4(DEK_S) → SM4(DEK_A)），
    // 服务端无任何一把 DEK 明文，KMS 重封管线不可用——一律转供应商端补传
    // （POST /api/supplier-portal/bid-submissions/:projectId/reupload-dual，供应商重新双层加密 + 重签信封）。
    if (submission.envelopeVersion === 'dual-v2') {
      throw new BadRequestException({ error: '新轨项目请走供应商端补传', code: 'USE_SUPPLIER_REUPLOAD' });
    }

    const assetId = submission[fields.assetIdKey] as string | null;
    if (!assetId) throw new BadRequestException({ error: `缺少${role} 文件引用`, code: 'NO_FILE_REF' });

    const originalAsset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
    if (!originalAsset || !originalAsset.sha256) {
      throw new BadRequestException({ error: '原始文件记录缺失，无法校验', code: 'FILE_RECORD_MISSING' });
    }

    // ── SHA-256 安全闸门：上传文件必须与原始标书逐字节一致 ──
    const uploadSha = crypto.createHash('sha256').update(file.buffer).digest('hex');
    if (uploadSha !== originalAsset.sha256) {
      this.logger.warn(`reupload SHA-256 mismatch: supplier=${bidSupplier.supplierName} role=${role} original=${originalAsset.sha256} upload=${uploadSha} actor=${actorId}`);
      // 安全事件审计：疑似标书替换尝试，通知监督端
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
          action: '标书补传拦截', result: `${role} 文件 SHA-256 不匹配，拒绝恢复（疑似替换尝试）`, riskFlag: '高风险' },
      }).catch(() => {});
      this.gateway?.notifyAnomaly(projectId, {
        type: 'tamper_attempt', supplierId, supplierName: bidSupplier.supplierName,
        detail: `${role} 文件补传被拦截：上传文件与原始标书不一致（SHA-256 不匹配）`, severity: 'danger',
      });
      if (actorId) {
        this.prisma.auditLog.create({
          data: { userId: actorId, action: 'BID_FILE_REUPLOAD_REJECTED',
            resourceType: `${bidSupplier.supplierName}:${supplierId}`,
            details: { projectId, role, originalSha256: originalAsset.sha256, uploadSha } },
        }).catch(() => {});
      }
      throw new BadRequestException({
        error: '上传文件与原始标书内容不一致（SHA-256 不匹配），疑似非原始文件，拒绝恢复',
        code: 'FILE_HASH_MISMATCH',
      });
    }

    // ── 重新加密（复用 submitBid 加密管线） ──
    const { ciphertext, decryptKey } = encryptBuffer(file.buffer);
    const wrappedKey = wrapKey(decryptKey, process.env.KMS_SECRET!);
    const sealedPath = `reupload/${projectId}/${supplierId}/${role}-${Date.now()}.enc`;

    try {
      await minioClient.putObject(MINIO_BUCKET, sealedPath, ciphertext, ciphertext.length, {
        'Content-Type': 'application/octet-stream',
      });
    } catch (err) {
      this.logger.error(`reupload MinIO putObject failed: ${sealedPath}`, err);
      throw new BadRequestException({ error: '文件存储失败，请重试', code: 'STORAGE_FAILED' });
    }

    // ── 事务：覆盖文件引用 + 重置 DANGER + 审计三件套 ──
    const sealedKeyUpdate: Record<string, string> = {};
    sealedKeyUpdate[fields.sealedKeyKey] = wrappedKey;

    await this.prisma.$transaction(async (tx) => {
      await tx.fileAsset.update({
        where: { id: assetId },
        // reupload 后文件变为 server-encrypted，清除 E2EE 标记
        data: { sealedPath, encrypted: true, clientEncrypted: false },
      });
      await tx.supplierBidSubmission.update({
        where: { supplierId_projectId: { supplierId: bidSupplier.supplierId!, projectId } },
        data: sealedKeyUpdate as any,
      });
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { decryptStatus: 'PENDING', decryptError: null, decryptedAt: null },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
          action: '标书补传', result: `${role} 文件已恢复（SHA-256 一致）`, riskFlag: '高风险',
        },
      });
      this.gateway?.notifySupervisionLog(projectId, {
        role: '主持人', action: '标书补传', target: bidSupplier.supplierName,
        result: `${role} 文件已恢复（SHA-256 一致）`, riskFlag: '高风险',
      });
      if (actorId) {
        await tx.auditLog.create({
          data: {
            userId: actorId, action: 'BID_FILE_REUPLOAD',
            resourceType: `${bidSupplier.supplierName}:${supplierId}`,
            details: { projectId, role, originalSha256: originalAsset.sha256, uploadSha, phase: 'recovery' },
          },
        });
      }
    });

    // ── 自动重解密（事务外，窗口关了就只修复不重解） ──
    try {
      await this.decryptSupplier(projectId, supplierId, undefined, actorId);
      return { recovered: true, decrypted: true, decryptStatus: 'SUCCESS' };
    } catch (e) {
      this.logger.warn(`reupload auto-decrypt failed (file recovered): ${(e as Error).message}`);
      return { recovered: true, decrypted: false, message: '文件已修复，请点「重试解密」或确认解密窗口是否开启' };
    }
  }

  /**
   * 管理员一键重新封标（兜底机制）。
   * E2EE（clientEncrypted）文件：用当前 KMS_SECRET 重新包裹 DEK（支持 KMS 轮转），密文不动；
   * 服务端明文恢复通道已删除（Task 16 旧轨收窄）——非 E2EE 文件请走标书补传（reuploadBidFile，SHA-256 闸门）；
   * dual-v2（新轨双层加密）项目一律转供应商端补传（服务器无任何 DEK 明文，KMS 重封不可用）。
   * 遍历 technical/business/coverLetter 三个角色。仅 OPENING 阶段允许。
   */
  async resealBidFiles(projectId: string, supplierId: string, actorId: string) {
    // ── 阶段门 ──
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new ForbiddenException({ error: '仅开标阶段可重新封标', code: 'STAGE_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { projectId, id: supplierId } });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
        })
      : null;
    if (!submission) throw new BadRequestException({ error: '供应商未提交投标文件', code: 'NO_SUBMISSION' });

    // ── Task 16 旧轨收窄：dual-v2 一律转供应商端补传（同 reuploadBidFile 分派口径）──
    if (submission.envelopeVersion === 'dual-v2') {
      throw new BadRequestException({ error: '新轨项目请走供应商端补传', code: 'USE_SUPPLIER_REUPLOAD' });
    }

    const ROLE_MAP = {
      technical:   { assetIdKey: 'technicalFileAssetId',  sealedKeyKey: 'technicalSealedKey',  label: '技术标' },
      business:    { assetIdKey: 'businessFileAssetId',   sealedKeyKey: 'businessSealedKey',   label: '商务标' },
      coverLetter: { assetIdKey: 'coverLetterAssetId',    sealedKeyKey: 'coverLetterSealedKey', label: '投标函' },
    } as const;

    const recovered: string[] = [];
    const failed: Array<{ role: string; label: string; code: string; error: string }> = [];

    for (const [role, fields] of Object.entries(ROLE_MAP)) {
      const assetId = submission[fields.assetIdKey as keyof typeof submission] as string | null;
      if (!assetId) continue; // 该角色无文件引用，跳过

      const originalAsset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
      if (!originalAsset || !originalAsset.sha256) {
        failed.push({ role, label: fields.label, code: 'FILE_RECORD_MISSING', error: '原始文件记录缺失' });
        continue;
      }

      if (originalAsset.clientEncrypted) {
        // ── E2EE 分支：密文在 asset.key，无需重加密。仅重新包裹 DEK（支持 KMS 轮转）──
        // key 要求只对 E2EE 有意义（密文路径）；非 E2EE 直接转标书补传，不读 key
        if (!originalAsset.key) {
          failed.push({ role, label: fields.label, code: 'FILE_RECORD_MISSING', error: '原始文件记录缺失' });
          continue;
        }
        const oldSealedKey = submission?.[fields.sealedKeyKey as keyof typeof submission] as string | undefined;
        if (!oldSealedKey || !isWrappedKey(oldSealedKey)) {
          failed.push({ role, label: fields.label, code: 'MISSING_E2EE_KEY', error: 'E2EE 文件缺少有效 sealedKey' });
          continue;
        }
        const oldDek = unwrapKey(oldSealedKey, process.env.KMS_SECRET!);
        const wrappedKey = wrapKey(oldDek, process.env.KMS_SECRET!);

        // sealedPath 不变（密文已在 asset.key），仅更新 wrappedKey
        const sealedKeyUpdate: Record<string, string> = {};
        sealedKeyUpdate[fields.sealedKeyKey] = wrappedKey;

        await this.prisma.$transaction(async (tx) => {
          await tx.supplierBidSubmission.update({
            where: { supplierId_projectId: { supplierId: bidSupplier.supplierId!, projectId } },
            data: sealedKeyUpdate as any,
          });
          await tx.bidSupplier.update({ where: { id: supplierId }, data: { decryptStatus: 'PENDING', decryptError: null, decryptedAt: null } });
          await tx.bidSupervisionLog.create({
            data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
              action: '重新封标', result: `${fields.label}（E2EE）已重新包裹密钥`, riskFlag: '低风险' },
          });
          if (actorId) {
            await tx.auditLog.create({
              data: { userId: actorId, action: 'BID_FILE_RESEAL', resourceType: `${bidSupplier.supplierName}:${supplierId}`,
                details: { projectId, role, e2ee: true } },
            });
          }
        });
        recovered.push(fields.label);
        continue;
      }

      // Task 16 旧轨收窄：服务端明文恢复通道已删除——FileAsset.key 明文不得再被服务端读回。
      // 非 E2EE（服务端加密）文件无法就地重封，一律转标书补传（reuploadBidFile，SHA-256 闸门）。
      failed.push({ role, label: fields.label, code: 'RESEAL_PLAINTEXT_RECOVERY_REMOVED', error: '服务端明文恢复通道已下线，请使用标书补传恢复' });
      continue;
    }

    if (recovered.length > 0) {
      this.gateway?.notifySupervisionLog(projectId, {
        role: '主持人', action: '重新封标', target: bidSupplier.supplierName,
        result: `${recovered.join('、')} 已恢复`, riskFlag: '高风险',
      });
    }

    // 文件校验失败（损坏/篡改/丢失）：安全事件，通知监督端并审计
    if (failed.length > 0) {
      const failDetail = failed.map(f => `${f.label}: ${f.error}`).join('；');
      const allRemovedChannel = failed.every(f => f.code === 'RESEAL_PLAINTEXT_RECOVERY_REMOVED');
      if (allRemovedChannel) {
        // Task 16 fix：明文恢复通道退役 ≠ 文件损坏——不写 bidValidity='invalid'（load-bearing
        // 排除标记，标书补传 reuploadBidFile 不会清除它），不写「投标无效」叙事、不发
        // file_corruption 异常；仅落 decryptError + 低风险监督日志，引导走标书补传。
        const redirectMsg = `明文恢复通道已退役，请走补传：${failDetail}`;
        await this.prisma.bidSupplier.update({
          where: { id: supplierId },
          data: { decryptError: `重新封标失败：${failDetail}` },
        });
        await this.prisma.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
            action: '重新封标', result: redirectMsg, riskFlag: '低风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, {
          role: '主持人', action: '重新封标', target: bidSupplier.supplierName,
          result: redirectMsg, riskFlag: '低风险',
        });
      } else if (recovered.length === 0) {
        const invalidReason = `投标文件损坏无法恢复：${failDetail}。该供应商投标视为无效，将自动排除出评标`;
        await this.prisma.bidSupplier.update({
          where: { id: supplierId },
          data: { decryptError: `重新封标失败：${failDetail}`, bidValidity: 'invalid' },
        });
        // 监督日志 + 异常事件中明确呈现无效原因
        await this.prisma.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
            action: '投标无效', result: invalidReason, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, {
          role: '主持人', action: '投标无效', target: bidSupplier.supplierName,
          result: invalidReason, riskFlag: '高风险',
        });
        this.gateway?.notifyAnomaly(projectId, {
          type: 'file_corruption', supplierId, supplierName: bidSupplier.supplierName,
          detail: invalidReason, severity: 'danger',
        });
      } else {
        // 部分失败：记录异常 + 标记 bidValidity=invalid（部分文件不可恢复则整体不可评）
        await this.prisma.bidSupplier.update({
          where: { id: supplierId },
          data: { decryptError: `重新封标部分失败：${failDetail}`, bidValidity: 'invalid', confirmStatus: 'EXCEPTION' },
        });
        await this.prisma.bidSupervisionLog.create({
          data: { projectId, time: new Date(), role: '主持人', target: bidSupplier.supplierName,
            action: '重新封标异常', result: failDetail, riskFlag: '高风险' },
        });
        this.gateway?.notifySupervisionLog(projectId, {
          role: '主持人', action: '重新封标异常', target: bidSupplier.supplierName,
          result: failDetail, riskFlag: '高风险',
        });
        this.gateway?.notifyAnomaly(projectId, {
          type: 'file_corruption', supplierId, supplierName: bidSupplier.supplierName,
          detail: failDetail, severity: 'danger',
        });
      }
      if (actorId) {
        await this.prisma.auditLog.create({
          data: { userId: actorId, action: 'BID_FILE_RESEAL_FAILED',
            resourceType: `${bidSupplier.supplierName}:${supplierId}`,
            details: { projectId, failed } },
        });
      }
    }

    // 自动重解密
    let decrypted = false;
    if (recovered.length > 0) {
      try {
        await this.decryptSupplier(projectId, supplierId, undefined, actorId);
        decrypted = true;
      } catch (e) {
        this.logger.warn(`reseal auto-decrypt failed: ${(e as Error).message}`);
      }
    }

    return {
      recovered, failed, decrypted,
      message: recovered.length > 0
        ? `${recovered.join('、')} 已恢复${decrypted ? '并重新解密成功' : ''}`
        : '无文件可恢复',
    };
  }

  /**
   * 管理员重新加载招标文件（兜底机制）。
   * 招标文件一定在系统内（开标前提），此方法：
   * 1. 用完整 OR 条件查找（bidProjectId 或 projectCode 反查）
   * 2. 自动修复 bidProjectId 关联（getTenderDocument 只按 bidProjectId 查）
   * 3. 验证可解密（MinIO 密文 → unwrapKey → decryptBuffer）
   */
  async reloadTenderDocument(projectId: string, actorId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, projectCode: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });

    // 用完整 OR 条件查找（与 downloadTenderDocument 一致）
    const doc = await this.prisma.bidDocument.findFirst({
      where: {
        OR: [
          { bidProjectId: projectId },
          { announcement: { relatedProjectCode: project.projectCode ?? '' } },
        ],
      },
      include: { fileAsset: true },
    });

    if (!doc?.fileAsset) {
      return { status: 'missing' as const, message: '未找到招标文件，请确认已在 :3005 上传招标文件' };
    }

    // 如果 bidProjectId 未关联到当前项目，自动修复（getTenderDocument 只按 bidProjectId 查）
    let bidProjectIdFixed = false;
    if (!doc.bidProjectId) {
      await this.prisma.bidDocument.update({
        where: { id: doc.id },
        data: { bidProjectId: projectId },
      });
      bidProjectIdFixed = true;
    }

    // 验证可解密
    try {
      const ciphertext = await streamToBuffer(
        await minioClient.getObject(MINIO_BUCKET, doc.fileAsset.key),
      );
      const rawKey = isWrappedKey(doc.decryptKey)
        ? unwrapKey(doc.decryptKey, process.env.KMS_SECRET!)
        : doc.decryptKey;
      decryptBuffer(ciphertext, rawKey);

      if (actorId) {
        await this.prisma.auditLog.create({
          data: {
            userId: actorId, action: 'BID_TENDER_DOC_RELOAD',
            resourceType: `project:${projectId}`,
            details: { fileName: doc.fileAsset.originalName, bidProjectIdFixed },
          },
        });
      }

      return {
        status: 'ok' as const,
        message: bidProjectIdFixed
          ? `招标文件已关联并验证通过（${doc.fileAsset.originalName}）`
          : `招标文件可正常访问（${doc.fileAsset.originalName}）`,
      };
    } catch (err) {
      this.logger.warn(`reload tender document decrypt failed: ${(err as Error).message}`);
      return {
        status: 'decrypt_failed' as const,
        message: `招标文件解密失败：${(err as Error).message}，请在 :3005 重新上传招标文件`,
      };
    }
  }
}
