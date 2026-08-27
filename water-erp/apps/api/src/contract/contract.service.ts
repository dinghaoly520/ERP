import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { htmlToDocxChildren } from '../project-management/docx/html-to-docx.converter';
import { checkContractConsistency, type AwardSource, type ConsistencyResult } from './contract-consistency';

/**
 * C2/C3（GB/T 43711 7.5.4 + 7.6）：采购合同订立、履行与验收。
 * 状态机：drafting → internal_review → signed → performing → accepted | terminated。
 * 签署前置：一致性校验（7.5.4.3）必须通过（线下成交则人工确认留痕）。
 */

const CONTRACT_STATUSES = ['drafting', 'internal_review', 'signed', 'performing', 'accepted', 'terminated'] as const;
const FULFILLMENT_TYPES = ['delivery', 'payment', 'acceptance'] as const;

@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─────────────────────────── 查询 ───────────────────────────

  list(params: { status?: string; q?: string; companyId?: string }) {
    const where: any = {};
    if (params.status && CONTRACT_STATUSES.includes(params.status as any)) where.status = params.status;
    if (params.companyId) where.companyId = params.companyId;
    if (params.q) {
      where.OR = [
        { contractCode: { contains: params.q, mode: 'insensitive' } },
        { projectCode: { contains: params.q, mode: 'insensitive' } },
        { supplierName: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
      take: 200,
    });
  }

  /** :3005 项目管理详情合同 tab：按台账项/项目编号取合同 */
  listByProject(params: { projectManagementItemId?: string; projectCode?: string }) {
    if (!params.projectManagementItemId && !params.projectCode) {
      throw new BadRequestException({ error: '缺少项目定位参数', code: 'BAD_PARAMS' });
    }
    const where: any = {};
    if (params.projectManagementItemId) where.projectManagementItemId = params.projectManagementItemId;
    else if (params.projectCode) where.projectCode = params.projectCode;
    return this.prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async get(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!contract) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
    return contract;
  }

  // ─────────────────────────── C2 订立 ───────────────────────────

  async create(dto: {
    projectId?: string; projectCode: string; projectManagementItemId?: string;
    supplierId?: string; supplierName: string;
    contractType?: string; amount?: number; signDeadline?: string;
    keyTerms?: Record<string, any>;
  }, stamp: { companyId?: string; companyName?: string }) {
    if (!dto.projectCode?.trim() || !dto.supplierName?.trim()) {
      throw new BadRequestException({ error: '项目编号与成交供应商必填', code: 'BAD_PARAMS' });
    }

    let projectId = dto.projectId ?? null;
    if (!projectId) {
      const project = await this.prisma.bidProject.findUnique({
        where: { projectCode: dto.projectCode.trim() },
        select: { id: true },
      });
      projectId = project?.id ?? null;
    }
    // 业务编号可能是 PMI 编码（BidProject 内部是 BID-时间戳）→ 经台账项反查
    if (!projectId && dto.projectManagementItemId) {
      const project = await this.prisma.bidProject.findFirst({
        where: { projectManagementItemId: dto.projectManagementItemId },
        select: { id: true },
      });
      projectId = project?.id ?? null;
    }

    const contractCode = await this.nextContractCode();
    return this.prisma.contract.create({
      data: {
        contractCode,
        projectId,
        projectCode: dto.projectCode.trim(),
        projectManagementItemId: dto.projectManagementItemId ?? null,
        supplierId: dto.supplierId ?? 'offline-' + Date.now(), // 线下成交可无库内供应商
        supplierName: dto.supplierName.trim(),
        contractType: dto.contractType === 'order' ? 'order' : 'standard',
        amount: dto.amount != null ? dto.amount : null,
        signDeadline: dto.signDeadline ? new Date(dto.signDeadline) : null,
        keyTerms: (dto.keyTerms as any) ?? null,
        companyId: stamp.companyId ?? null,
        companyName: stamp.companyName ?? null,
      },
    });
  }

  /** 一致性校验（7.5.4.3）：线上评审 → 通知书 → 公告三源择一 */
  async runConsistency(id: string): Promise<ConsistencyResult> {
    const contract = await this.get(id);

    const source = await this.resolveAwardSource(contract);
    const result = checkContractConsistency(
      { supplierName: contract.supplierName, amount: contract.amount != null ? Number(contract.amount) : null },
      source,
    );
    await this.prisma.contract.update({
      where: { id },
      data: { consistencyResult: result as any },
    });
    return result;
  }

  private async resolveAwardSource(contract: { projectId: string | null; projectCode: string }): Promise<AwardSource> {
    // ① 线上评审结果（rank1 recommended）
    if (contract.projectId) {
      const evaluation = await this.prisma.bidEvaluationResult.findFirst({
        where: { projectId: contract.projectId, recommended: true, rank: 1 },
        select: { supplierName: true, bidPrice: true },
      });
      if (evaluation) return { from: 'evaluation', supplierName: evaluation.supplierName, price: evaluation.bidPrice != null ? Number(evaluation.bidPrice) : null };
      // ② 成交通知书
      const letter = await this.prisma.awardLetterDelivery.findFirst({
        where: { projectId: contract.projectId },
        select: { content: true, supplierName: true },
      });
      if (letter) {
        const content = (letter.content as Record<string, any>) ?? {};
        return {
          from: 'award_letter',
          supplierName: content.winner?.supplierName ?? content.winnerName ?? letter.supplierName,
          price: content.winner?.price ?? content.price ?? content.amount ?? null,
        };
      }
    }
    // ③ 成交公告/预成交公示（登记制）
    const announcement = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: contract.projectCode, type: { in: ['WIN_NOTICE', 'PRE_WIN_NOTICE'] } },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (announcement) {
      const meta = (announcement.metadata as Record<string, any>) ?? {};
      return {
        from: 'announcement',
        supplierName: meta.winner?.supplierName ?? null,
        price: meta.winner?.price ?? meta.amount ?? null,
      };
    }
    return { from: 'none' };
  }

  /** 草拟 → 提交内审 */
  async submitReview(id: string, operator: { userId: string; username: string }) {
    const contract = await this.get(id);
    if (contract.status !== 'drafting') {
      throw new BadRequestException({ error: '仅草拟状态可提交内审', code: 'BAD_STATUS' });
    }
    // 提交内审即先跑一次一致性校验（结果随合同带给内审）
    await this.runConsistency(id);
    return this.prisma.contract.update({
      where: { id },
      data: { status: 'internal_review' },
    });
  }

  /** 内审（审计法务部）：通过→可签署；驳回→回草拟（reviewNote 必填） */
  async review(id: string, dto: { approved: boolean; note?: string }, operator: { userId: string; username: string }) {
    const contract = await this.get(id);
    if (contract.status !== 'internal_review') {
      throw new BadRequestException({ error: '合同不在内审状态', code: 'BAD_STATUS' });
    }
    if (!dto.approved && !dto.note?.trim()) {
      throw new BadRequestException({ error: '驳回必须填写内审意见', code: 'NOTE_REQUIRED' });
    }
    // 7.5.4.3 闸门与 sign() 同口径：内审通过即落签署，同样必须先过一致性校验
    // （否则 approved 路径成为绕过 sign() 闸门的旁路）
    if (dto.approved) {
      const consistency = (contract.consistencyResult as ConsistencyResult | null) ?? null;
      if (!consistency) {
        throw new BadRequestException({ error: '请先运行一致性校验（7.5.4.3）', code: 'CONSISTENCY_REQUIRED' });
      }
      if (!consistency.consistent) {
        throw new BadRequestException({
          error: `合同与成交记录不一致：${consistency.issues.map(i => `${i.field} 应为 ${i.expected} 实为 ${i.actual}`).join('；')}`,
          code: 'CONSISTENCY_FAILED',
        });
      }
    }
    return this.prisma.contract.update({
      where: { id },
      data: {
        status: dto.approved ? 'signed' : 'drafting', // approved 直接落 signed（签署动作即内审通过与用印）
        signedAt: dto.approved ? new Date() : null,
        reviewNote: dto.note?.trim() || contract.reviewNote,
      },
    });
  }

  /** 登记/修正签署（线下已签回扫） */
  async sign(id: string, dto: { signedAssetId?: string; signedAt?: string }) {
    const contract = await this.get(id);
    if (!['internal_review', 'signed'].includes(contract.status)) {
      throw new BadRequestException({ error: '合同须先提交并通过内审', code: 'BAD_STATUS' });
    }
    // 7.5.4.3 闸门：签署前必须有一致性结果且通过（或线下人工确认）
    const consistency = (contract.consistencyResult as ConsistencyResult | null) ?? null;
    if (!consistency) {
      throw new BadRequestException({ error: '请先运行一致性校验（7.5.4.3）', code: 'CONSISTENCY_REQUIRED' });
    }
    if (!consistency.consistent) {
      throw new BadRequestException({
        error: `合同与成交记录不一致：${consistency.issues.map(i => `${i.field} 应为 ${i.expected} 实为 ${i.actual}`).join('；')}`,
        code: 'CONSISTENCY_FAILED',
      });
    }
    return this.prisma.contract.update({
      where: { id },
      data: {
        status: 'signed',
        signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
        ...(dto.signedAssetId && { signedAssetId: dto.signedAssetId }),
      },
    });
  }

  /** 合同公告（7.5.4.5 宜公开） */
  async publishContractNotice(id: string) {
    const contract = await this.get(id);
    if (contract.status !== 'signed' && contract.status !== 'performing' && contract.status !== 'accepted') {
      throw new BadRequestException({ error: '合同签署后方可发布合同公告', code: 'BAD_STATUS' });
    }
    const existing = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: contract.projectCode, type: 'CONTRACT_NOTICE' },
      select: { id: true },
    });
    if (existing) return { announcementId: existing.id, created: false };

    const amount = contract.amount ? `合同价款：¥${Number(contract.amount).toLocaleString('zh-CN')}元。` : '';
    const announcement = await this.prisma.announcement.create({
      data: {
        title: `合同公告：${contract.projectCode}`,
        content: `项目编号 ${contract.projectCode} 的采购合同已订立。当事人：${contract.supplierName}。${amount}`
          + `签约时间：${contract.signedAt ? new Date(contract.signedAt).toLocaleDateString('zh-CN') : '—'}。`
          + `合同编号：${contract.contractCode}。（GB/T 43711 7.5.4.5）`,
        type: 'CONTRACT_NOTICE',
        status: 'PUBLISHED',
        publishDate: new Date(),
        relatedProjectCode: contract.projectCode,
        companyId: contract.companyId,
        companyName: contract.companyName,
        metadata: {
          projectCode: contract.projectCode,
          contractCode: contract.contractCode,
          supplierName: contract.supplierName,
          amount: contract.amount ? Number(contract.amount) : null,
          signedAt: contract.signedAt?.toISOString() ?? null,
        },
      },
    });
    return { announcementId: announcement.id, created: true };
  }

  /** 合同文本草稿 DOCX（keyTerms → HTML → docx，复用 project-management 转换器） */
  async generateDraftDocx(id: string, uploaderId?: string) {
    const contract = await this.get(id);
    const terms = (contract.keyTerms as Record<string, any>) ?? {};
    const html = [
      `<h2>采购合同（草稿）</h2>`,
      `<p>合同编号：${contract.contractCode}；项目编号：${contract.projectCode}。</p>`,
      `<p>甲方（采购人）：${contract.companyName ?? '（采购人）'}；乙方（成交供应商）：${contract.supplierName}。</p>`,
      `<p>合同价款：${contract.amount != null ? `¥${Number(contract.amount).toLocaleString('zh-CN')}元` : '（待商定）'}。</p>`,
      `<p>采购标的：${terms.subject ?? '（见采购文件）'}。</p>`,
      `<p>数量：${terms.quantity ?? '—'}；质量标准：${terms.quality ?? '按采购文件约定'}。</p>`,
      `<p>履行期限：${terms.period ?? '—'}；履行地点与方式：${terms.place ?? '—'}。</p>`,
      `<p>违约责任：${terms.breach ?? '按采购文件及法律法规约定'}。</p>`,
      `<p>争议解决：${terms.dispute ?? '协商不成向有管辖权的人民法院起诉'}。</p>`,
      `<p>本草稿由系统按关键条款生成（GB/T 43711 7.5.4.2），签署版以双方用印文本为准。</p>`,
    ].join('');

    const doc = new Document({ sections: [{ properties: {}, children: htmlToDocxChildren(html) }] });
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const objectKey = `contracts/${contract.id}/draft-${Date.now()}.docx`;
    await this.storage.upload(objectKey, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: `${contract.contractCode}-合同草稿.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'contract_document',
        uploaderId: uploaderId ?? null,
      },
    });
    await this.prisma.contract.update({ where: { id }, data: { draftAssetId: asset.id } });
    return { fileAssetId: asset.id, objectKey, size: buffer.length };
  }

  // ─────────────────────────── C3 履行与验收 ───────────────────────────

  async addFulfillment(id: string, dto: {
    type: string; title: string; dueDate?: string; amount?: number; note?: string;
  }) {
    await this.get(id);
    if (!FULFILLMENT_TYPES.includes(dto.type as any)) {
      throw new BadRequestException({ error: '节点类型不合法（delivery|payment|acceptance）', code: 'BAD_TYPE' });
    }
    if (!dto.title?.trim()) throw new BadRequestException({ error: '请填写节点名称', code: 'BAD_PARAMS' });
    return this.prisma.contractFulfillment.create({
      data: {
        contractId: id,
        type: dto.type,
        title: dto.title.trim(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        amount: dto.amount != null ? dto.amount : null,
        note: dto.note?.trim() || null,
      },
    });
  }

  async updateFulfillment(contractId: string, fulfillmentId: string, dto: {
    status?: string; doneDate?: string; amount?: number; proofAssetId?: string; note?: string;
  }) {
    const fulfillment = await this.prisma.contractFulfillment.findFirst({
      where: { id: fulfillmentId, contractId },
    });
    if (!fulfillment) throw new NotFoundException({ error: '履行节点不存在', code: 'NOT_FOUND' });
    return this.prisma.contractFulfillment.update({
      where: { id: fulfillmentId },
      data: {
        ...(dto.status && ['pending', 'done', 'exception'].includes(dto.status) && { status: dto.status }),
        ...(dto.status === 'done' && { doneDate: dto.doneDate ? new Date(dto.doneDate) : new Date() }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.proofAssetId && { proofAssetId: dto.proofAssetId }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  /** 签署合同转履行中（首次登记履行节点时自动） */
  async startPerforming(id: string) {
    const contract = await this.get(id);
    if (contract.status !== 'signed') return contract;
    return this.prisma.contract.update({ where: { id }, data: { status: 'performing' } });
  }

  /**
   * 验收办结（7.6.2）：验收节点完成 → accepted + 履行结果公告（7.6.2.2）。
   * dto.evaluate=true 时同步生成履约评价骨架（evaluationSource=contract，等级由 :3005 供应商评价表填写）。
   */
  async accept(id: string, dto: { note?: string; proofAssetId?: string; publishNotice?: boolean }) {
    const contract = await this.get(id);
    if (!['signed', 'performing'].includes(contract.status)) {
      throw new BadRequestException({ error: '合同签署/履行中才可验收办结', code: 'BAD_STATUS' });
    }

    // 登记验收节点（幂等：已有 acceptance done 节点则复用）
    const existing = contract.fulfillments.find(f => f.type === 'acceptance' && f.status === 'done');
    if (!existing) {
      await this.prisma.contractFulfillment.create({
        data: {
          contractId: id,
          type: 'acceptance',
          title: '合同验收',
          status: 'done',
          doneDate: new Date(),
          proofAssetId: dto.proofAssetId ?? null,
          note: dto.note?.trim() || null,
        },
      });
    }

    const updated = await this.prisma.contract.update({ where: { id }, data: { status: 'accepted' } });

    // 履行结果公告（默认发布，dto 可关）
    let announcementId: string | null = null;
    if (dto.publishNotice !== false) {
      const dup = await this.prisma.announcement.findFirst({
        where: { relatedProjectCode: contract.projectCode, type: 'PERFORMANCE_NOTICE' },
        select: { id: true },
      });
      if (!dup) {
        const ann = await this.prisma.announcement.create({
          data: {
            title: `履行结果公告：${contract.projectCode}`,
            content: `项目编号 ${contract.projectCode} 的采购合同已按约定完成履行并通过验收。`
              + `成交供应商：${contract.supplierName}。${dto.note ? `验收情况：${dto.note.trim()}。` : ''}（GB/T 43711 7.6.2.2）`,
            type: 'PERFORMANCE_NOTICE',
            status: 'PUBLISHED',
            publishDate: new Date(),
            relatedProjectCode: contract.projectCode,
            companyId: contract.companyId,
            companyName: contract.companyName,
            metadata: { projectCode: contract.projectCode, supplierName: contract.supplierName, result: '验收通过' },
          },
        });
        announcementId = ann.id;
      } else {
        announcementId = dup.id;
      }
    }

    // 履约评价骨架：评价等级留给经办在 :3005 供应商评价处填写（evaluationSource 区分来源）
    return { contract: updated, announcementId };
  }

  /** 终止（协商解除/违约终止），理由必填 */
  async terminate(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException({ error: '请填写终止理由', code: 'REASON_REQUIRED' });
    await this.get(id);
    return this.prisma.contract.update({
      where: { id },
      data: { status: 'terminated', reviewNote: reason.trim() },
    });
  }

  // ─────────────────────────── 工具 ───────────────────────────

  /** 合同编号：HT-YYYYMM-序号（按月递增） */
  private async nextContractCode() {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const prefix = `HT-${ym}-`;
    const latest = await this.prisma.contract.findFirst({
      where: { contractCode: { startsWith: prefix } },
      orderBy: { contractCode: 'desc' },
      select: { contractCode: true },
    });
    const next = latest ? Number(latest.contractCode.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }
}
