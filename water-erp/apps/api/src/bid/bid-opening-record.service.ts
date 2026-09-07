import { Injectable, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { evaluateBondCompliance } from '@water-erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BidGateway } from './bid.gateway';
import { stripOpeningConfirmSignature } from '../supplier-portal/opening-confirm-signature.util';
import { openField } from '../common/crypto/field-crypto';
import { CreateOpeningRecordDto } from './dto/create-opening-record.dto';
import { ResolveOpeningDisputeDto } from './dto/resolve-opening-dispute.dto';
import { assertPriceMatchesSealed, assertPeriodMatchesSubmitted } from './opening-record-assert.util';

/** 开标记录/异议域（F1c）——自 bid.service.ts 迁出（P1 审查 F 簇拆分，纯移动）。索引：listOpeningRecords / getOpeningRecordDraft / enterOpeningRecord / resolveOpeningDispute / overrideDispute；唱标校验共用 opening-record-assert.util */
@Injectable()
export class BidOpeningRecordService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

  private readonly logger = new Logger(BidOpeningRecordService.name);

  // A-114：唱标总表（主持端）——确认签名剥壳为摘要（完整证据走本人视图与文件包）
  async listOpeningRecords(projectId: string) {
    const records = await this.prisma.bidOpeningRecord.findMany({ where: { projectId } });
    return records.map((r) => ({ ...r, confirmSignature: stripOpeningConfirmSignature(r) }));
  }

  /**
   * 唱标预填草稿：聚合项目级质量目标 + 投标提交的报价/工期/质量承诺 + 已有开标记录的保证金状态。
   * 质量承诺口径（2026-08-17）：优先供应商投递的质量承诺（qualityCommitment），未填写回退项目级
   * qualityRequirement——唱标不再凭空增项。
   * 仅 OPENING 阶段且该供应商解密成功才返回真实数据（canView=true），
   * 保证金凭证（bidBondAssetId）同样仅此时可见，供主持人核对。
   */
  async getOpeningRecordDraft(projectId: string, bidSupplierId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, qualityRequirement: true, bondRequired: true, bondAmount: true, deadline: true },
    });
    const empty = { canView: false, amount: null, period: null, qualityTarget: null, bondStatus: null, bidBondAssetId: null, bondNotApplicable: false, bondCompliance: null };
    if (!project || project.stage !== 'OPENING') return { ...empty, qualityTarget: project?.qualityRequirement ?? null };

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: bidSupplierId, projectId },
      select: { id: true, decryptStatus: true, supplierId: true, supplierName: true },
    });
    if (!bidSupplier || bidSupplier.decryptStatus !== 'SUCCESS') return empty;

    const submission = bidSupplier.supplierId
      ? await this.prisma.supplierBidSubmission.findUnique({
          where: { supplierId_projectId: { supplierId: bidSupplier.supplierId, projectId } },
          select: { bidPrice: true, decryptedPrice: true, deliveryPeriod: true, bidBondAssetId: true, qualityCommitment: true, envelopeVersion: true, decryptedAssets: true },
        })
      : null;

    const existingRecord = await this.prisma.bidOpeningRecord.findFirst({
      where: { projectId, bidSupplierId },
      select: { bondStatus: true },
    });

    // §5.4a：dual-v2 保证金凭证下发 decryptedAssets['bond'] 明文资产（C_outer 密文已被下载端拒收）
    const bondAssetId = submission?.envelopeVersion === 'dual-v2' && submission.decryptedAssets
      ? ((submission.decryptedAssets as Record<string, unknown>)['bond'] as string | undefined) ?? null
      : (submission?.bidBondAssetId ?? null);

    // A-104：到账台账按（projectId, supplierName 名册自然键）取唯一行，无台账=「未登记到账台账」
    const ledger = project.bondRequired
      ? await this.prisma.bidBondLedger.findUnique({
          where: { projectId_supplierName: { projectId, supplierName: bidSupplier.supplierName } },
        })
      : null;

    return {
      canView: true,
      // bidPrice 入库已密封；此处 canView=true 已保证 decryptStatus==='SUCCESS'，安全拆封。
      // 旧明文数据经 openField legacy 兼容原样返回。
      // dual-v2（P1-4 同口径）：报价改指 decryptedPrice（解密上传经 fieldsCommit 承诺验证落库；
      // 新轨投递 bidPrice 列恒 null，读旧列会显示 null 价 → 主持人按面板录入必撞 409 PRICE_MISMATCH）。
      amount: submission
        ? (submission.envelopeVersion === 'dual-v2'
            ? (submission.decryptedPrice ?? null)
            : (submission.bidPrice ? openField(submission.bidPrice, process.env.KMS_SECRET!) : null))
        : null,
      period: submission?.deliveryPeriod ?? null,
      qualityTarget: submission?.qualityCommitment || project.qualityRequirement,
      bondStatus: existingRecord?.bondStatus ?? null,
      bidBondAssetId: bondAssetId,
      bondNotApplicable: !project.bondRequired,
      // A-104：保证金符合性自动比对（台账 × bondAmount/截标 × 唱标录入状态）——只提示不裁决
      bondCompliance: (() => {
        if (!project.bondRequired) return null;
        return { issues: evaluateBondCompliance({
          hasLedger: !!ledger,
          hasVoucher: !!bondAssetId, // A-104 凭证维：唱标预填上下文内核（bondAssetId 已在上方解析）
          amount: ledger ? Number(ledger.amount) : null,
          arrivedAt: ledger?.arrivedAt?.toISOString() ?? null,
          payMethod: ledger?.payMethod ?? null,
          requiredAmount: project.bondAmount != null ? Number(project.bondAmount) : null,
          deadline: project.deadline.toISOString(),
          bondStatus: existingRecord?.bondStatus ?? null,
        }) };
      })(),
    };
  }

  /**
   * 主持人录入唱标信息（报价/工期/质量目标/保证金）。
   * 解决"解密不落开标记录"的断链：解密仅做密文校验，唱标信息由主持人据解密内容补录，
   * 据此生成/更新 BidOpeningRecord（confirmStatus=待供应商确认），供供应商确认或异议。
   * 仅在 OPENING 阶段可录入；投标须已解密成功。按 bidSupplierId 幂等 upsert。
   */
  async enterOpeningRecord(projectId: string, dto: CreateOpeningRecordDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '唱标信息录入需在开标阶段进行', code: 'NOT_OPENING_STAGE' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: dto.bidSupplierId, projectId },
      select: { id: true, supplierId: true, supplierName: true, decryptStatus: true, confirmStatus: true },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '投标记录不存在', code: 'BID_SUPPLIER_NOT_FOUND' });
    if (bidSupplier.decryptStatus !== 'SUCCESS') {
      throw new BadRequestException({ error: '标书尚未解密成功，无法录入唱标信息', code: 'NOT_DECRYPTED' });
    }
    // H11: 供应商已确认的记录禁止覆盖——否则记录回「待供应商确认」而供应商侧仍 CONFIRMED，
    // generateEvaluationResults 只看 bidSupplier.confirmStatus，主持人单方改报价会默认生效。
    if (bidSupplier.confirmStatus === 'CONFIRMED') {
      throw new ConflictException({ error: '该供应商已确认开标记录，禁止覆盖唱标信息', code: 'RECORD_ALREADY_CONFIRMED' });
    }

    // P1-4：与供应商密封报价比对（误录一路进排名/中标公示的防线）
    const priceNote = await assertPriceMatchesSealed(this.prisma, projectId, bidSupplier.id, dto.amount, dto.confirmSealedPrice);
    // P1-4 同构：与投递工期比对（误录工期一路进评标/公示的防线）
    const periodNote = await assertPeriodMatchesSubmitted(this.prisma, projectId, bidSupplier.id, dto.period, dto.confirmSealedPeriod);

    const payload = {
      amount: dto.amount,
      period: dto.period,
      qualityTarget: dto.qualityTarget,
      bondStatus: dto.bondStatus,
      decryptResult: '解密成功',
      confirmStatus: '待供应商确认',
    };

    // P0: Wrap check-then-act + log in transaction to prevent duplicate record race
    const record = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.bidOpeningRecord.findFirst({
        where: { projectId, bidSupplierId: bidSupplier.id },
      });
      // 状态门（Wave4a-I1）：已确认/异议/已处理的记录不得被唱标重录覆写——否则异议态记录被
      // 覆写回「待供应商确认」（objectionReason 残留）后 resolve 撞 R7 状态门 400，bidSupplier
      // 永久停留 DISPUTED 并被 generateEvaluationResults 静默排除（R7 引入的交互回归楔子）。
      const LOCKED = ['供应商已确认', '供应商提出异议', '异议已处理-确认', '异议已处理-退回'];
      if (existing && LOCKED.includes(existing.confirmStatus)) {
        throw new ConflictException({
          error: `开标记录处于「${existing.confirmStatus}」状态，不得重录唱标；请通过异议处理结果（维持/退回）完成闭环`,
          code: 'RECORD_LOCKED',
        });
      }
      // N1b：upsert（projectId+bidSupplierId 复合唯一兜底）——上面 findFirst 仅服务状态门，
      // 写入不再 check-then-act，并发双击不会双建记录。
      const rec = await tx.bidOpeningRecord.upsert({
        where: { projectId_bidSupplierId: { projectId, bidSupplierId: bidSupplier.id } },
        create: { projectId, supplierName: bidSupplier.supplierName, bidSupplierId: bidSupplier.id, ...payload },
        update: payload,
      });

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '开标主持人', target: bidSupplier.supplierName,
          action: '录入唱标信息', result: `报价 ${dto.amount} / 工期 ${dto.period}${priceNote ?? ''}${periodNote ?? ''}`, riskFlag: priceNote || periodNote ? '中' : '无',
        },
      });
      return rec;
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '录入唱标信息', target: bidSupplier.supplierName, result: `报价 ${dto.amount} / 工期 ${dto.period}${priceNote ?? ''}${periodNote ?? ''}`, riskFlag: priceNote || periodNote ? '中' : '无' });
    // 唱标记录已录入/更新 → project 房广播（合规口径：唱标自开标起向全体投标人公开，
    // 广播触发各家供应商「唱标记录（全部投标人）」公开表刷新——见 2026-08-17 计划，勿收口）。
    // supplierId 传 Supplier.id（payload 语义与其他供应商侧事件一致；旧实现误传 BidSupplier.id）
    this.gateway?.notifyOpeningRecordUpdated(projectId, {
      supplierId: bidSupplier.supplierId as string,
      supplierName: bidSupplier.supplierName,
      recordId: record.id,
      amount: Number(dto.amount),
    });
    return record;
  }

  async resolveOpeningDispute(projectId: string, recordId: string, dto: ResolveOpeningDisputeDto, actorId?: string) {
    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { id: recordId, projectId } });
    if (!record) throw new BadRequestException({ error: '开标记录不存在', code: 'NOT_FOUND' });

    // P0: 阶段门控 — 仅在开标阶段可处理异议
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法处理异议', code: 'PROJECT_NOT_OPENING' });
    }

    // R7：状态机门 — 仅「供应商提出异议」态记录可处理。旧实现不校验记录态：主持人可"处理"
    // 从未被异议的记录（翻转确认态）、对已处理记录反复覆盖。阶段门控之后、事务之前拦截。
    if (record.confirmStatus !== '供应商提出异议') {
      throw new BadRequestException({ error: '该记录不处于异议待处理状态', code: 'DISPUTE_NOT_PENDING' });
    }

    const now = new Date();
    const confirmStatus = dto.confirm ? '异议已处理-确认' : '异议已处理-退回';
    // Wave4a-M5：监督日志记态迁移（前态 → 后态：处理结果），便于监督端回放异议闭环
    const supervisionResult = `供应商提出异议 → ${confirmStatus}：${dto.result}`;

    // P0: Wrap record update + supplier update + supervision log in transaction
    await this.prisma.$transaction(async (tx) => {
      // Wave4a-M4：事务内条件更新是并发防线——事务外的状态门基于 stale read，并发双处理都过门时
      // 仅首笔命中异议待处理行（count=1），第二笔 count=0 → 400，杜绝双落（与 R6 原子抢占同构）。
      // H6 并入：updateMany 同时写 handledBy 操作者留痕。
      const res = await tx.bidOpeningRecord.updateMany({
        where: { id: recordId, confirmStatus: '供应商提出异议' },
        data: { confirmStatus, handleResult: dto.result, handledAt: now, handledBy: actorId ?? null },
      });
      if (res.count === 0) {
        throw new BadRequestException({ error: '该异议已被处理', code: 'DISPUTE_NOT_PENDING' });
      }
      if (record.bidSupplierId) {
        await tx.bidSupplier.update({
          where: { id: record.bidSupplierId },
          data: { confirmStatus: dto.confirm ? 'CONFIRMED' : 'EXCEPTION' },
        });
      }
      // 全清 DISPUTED → 清除 disputedSince
      const remainingDisputed = await tx.bidSupplier.count({
        where: { projectId, confirmStatus: 'DISPUTED', submitStatus: { not: '已撤回' } },
      });
      if (remainingDisputed === 0) {
        await tx.bidOpeningSession.update({ where: { projectId }, data: { disputedSince: null } });
      }
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '开标主持人', target: record.supplierName,
          action: '处理开标异议', result: supervisionResult, riskFlag: '中风险',
        },
      });
      // H6: 操作者留痕（开标异议处理是法定留痕环节）
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_DISPUTE_RESOLVE', resourceType: `BidOpeningRecord:${recordId}`, details: { projectId, confirm: dto.confirm, result: dto.result } },
        });
      }
    });

    this.gateway?.notifySupervisionLog(projectId, { role: '开标主持人', action: '处理开标异议', target: record.supplierName, result: supervisionResult, riskFlag: '中风险' });
    if (record.bidSupplierId) {
      const bs = await this.prisma.bidSupplier.findUnique({
        where: { id: record.bidSupplierId },
        select: { supplierId: true },
      });
      if (bs?.supplierId) {
        this.gateway?.notifyOpeningDisputeResolved(projectId, bs.supplierId, {
          projectId, supplierId: bs.supplierId, supplierName: record.supplierName,
          recordId, confirm: dto.confirm, result: dto.result, timestamp: Date.now(),
        });
        // 发送站内信通知供应商异议处理结果（fire-and-forget）
        try {
          const supplier = await this.prisma.supplier.findUnique({
            where: { id: bs.supplierId }, select: { userId: true },
          });
          if (supplier?.userId) {
            await this.notificationService.sendToUser(supplier.userId, ['in_app'], {
              type: 'BID_DISPUTE_RESOLVED',
              title: `开标异议已处理：${record.supplierName}`,
              content: dto.confirm
                ? `您的异议已确认受理：${dto.result}`
                : `您的异议已处理（退回）：${dto.result}`,
              link: `/my-bids/${projectId}/opening-hall`,
            });
          }
        } catch { /* 通知失败不阻塞异议处理 */ }
      }
    }
    return this.prisma.bidOpeningRecord.findUnique({ where: { id: recordId } });
  }

  /**
   * 强制裁决（监督人应急通道）。
   * 供应商 DISPUTED/EXCEPTION 导致项目卡死时，leader/admin 可强制覆盖确认态。
   * target='exception'（默认）: DISPUTED→EXCEPTION（排除供应商）
   * target='confirmed': DISPUTED/EXCEPTION→CONFIRMED（恢复供应商参评）
   * 要求提供书面理由（入 audit log），写高风险监督日志。
   */
  async overrideDispute(projectId: string, supplierId: string, reason: string, actorId?: string, target: 'confirmed' | 'exception' = 'exception') {
    if (!reason?.trim()) throw new BadRequestException({ error: '请填写强制裁决理由', code: 'MISSING_REASON' });

    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId }, select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, id: supplierId },
      select: { id: true, supplierName: true, confirmStatus: true, decryptStatus: true },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '供应商投标记录不存在', code: 'NOT_FOUND' });
    // P2: 扩展接受 DISPUTED 和 EXCEPTION（CONFIRMED 无需覆盖）
    if (!['DISPUTED', 'EXCEPTION'].includes(bidSupplier.confirmStatus)) {
      throw new BadRequestException({ error: '仅异议中（DISPUTED）或异常（EXCEPTION）的供应商可被强制裁决', code: 'NOT_OVERRIDABLE' });
    }

    const targetStatus = target === 'confirmed' ? 'CONFIRMED' : 'EXCEPTION';
    const recordConfirmStatus = target === 'confirmed' ? '异议已处理-确认' : '异议已处理-退回';
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // 将关联的开标记录同步更新（如有）
      const record = await tx.bidOpeningRecord.findFirst({
        where: { projectId, bidSupplierId: supplierId },
      });
      if (record && ['供应商提出异议', '异议已处理-退回', '异议已处理-确认'].includes(record.confirmStatus)) {
        await tx.bidOpeningRecord.update({
          where: { id: record.id },
          data: { confirmStatus: recordConfirmStatus, handleResult: `[强制裁决] ${reason}`, handledAt: now, handledBy: actorId ?? null },
        });
      }
      await tx.bidSupplier.update({
        where: { id: supplierId },
        data: { confirmStatus: targetStatus },
      });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: now, role: '监督人', target: bidSupplier.supplierName,
          action: `强制裁决→${targetStatus}`, result: `${bidSupplier.confirmStatus}→${targetStatus}：${reason}`, riskFlag: '高风险',
        },
      });
      if (actorId) {
        await tx.auditLog.create({
          data: { userId: actorId, action: 'BID_DISPUTE_OVERRIDE', resourceType: `BidSupplier:${supplierId}`, details: { projectId, reason, target: targetStatus } },
        });
      }
      // 全清 DISPUTED → 清除 disputedSince
      const remaining = await tx.bidSupplier.count({ where: { projectId, confirmStatus: 'DISPUTED', submitStatus: { not: '已撤回' } } });
      if (remaining === 0) {
        await tx.bidOpeningSession.update({ where: { projectId }, data: { disputedSince: null } });
      }
    });

    this.gateway?.notifySupervisionLog(projectId, {
      role: '监督人', action: `强制裁决→${targetStatus}`, target: bidSupplier.supplierName,
      result: `${bidSupplier.confirmStatus}→${targetStatus}：${reason}`, riskFlag: '高风险',
    });

    return { overridden: true, supplierId, supplierName: bidSupplier.supplierName, confirmStatus: targetStatus };
  }
}
