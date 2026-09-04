import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { htmlToDocxChildren } from '../project-management/docx/html-to-docx.converter';
import { checkContractConsistency, type AwardSource, type ConsistencyResult } from './contract-consistency';
import { buildStandardFileName } from '@water-erp/shared';

/**
 * C2/C3（GB/T 43711 7.5.4 + 7.6）：采购合同订立、履行与验收。
 * 状态机：drafting → internal_review → approved_for_signing → signed → performing → accepted | terminated。
 * 签署前置：一致性校验（7.5.4.3）必须通过（线下成交则人工确认留痕）。
 */

const CONTRACT_STATUSES = [
  'drafting', 'internal_review', 'approved_for_signing', 'signed', 'performing', 'accepted', 'terminated',
] as const;
const FULFILLMENT_TYPES = ['delivery', 'payment', 'acceptance'] as const;
const CLOSED_CONTRACT_STATUSES = ['accepted', 'terminated'] as const;

type CompanyFilter = { companyId?: string };
type ContractActor = { userId: string; username?: string } & CompanyFilter;

@Injectable()
export class ContractService {
  private readonly logger = new Logger(ContractService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * 新挂接的合同附件必须来自当前操作者的合同文档上传，并且尚未被其他合同引用。
   * 同一合同内允许复用，以支持签署件/履约件在本合同证据链中关联。
   */
  private async assertContractDocumentAsset(
    assetId: string,
    contractId: string,
    actor: ContractActor,
    db: any = this.prisma,
  ) {
    const normalizedAssetId = assetId.trim();
    const asset = normalizedAssetId
      ? await db.fileAsset.findFirst({
          where: {
            id: normalizedAssetId,
            category: 'contract_document',
            uploaderId: actor.userId,
          },
          select: { id: true },
        })
      : null;
    if (!asset) {
      throw new BadRequestException({ error: '合同附件不存在或文件分类不正确', code: 'CONTRACT_ASSET_INVALID' });
    }

    const [otherContract, otherFulfillment, awardLetter] = await Promise.all([
      db.contract.findFirst({
        where: {
          id: { not: contractId },
          OR: [{ draftAssetId: asset.id }, { signedAssetId: asset.id }],
        },
        select: { id: true, supplierId: true },
      }),
      db.contractFulfillment.findFirst({
        where: { proofAssetId: asset.id, contractId: { not: contractId } },
        select: { id: true, contractId: true },
      }),
      db.awardLetterDelivery.findFirst({
        where: { letterAssetId: asset.id },
        select: { id: true, supplierId: true },
      }),
    ]);
    if (otherContract || otherFulfillment || awardLetter) {
      throw new ConflictException({
        error: '该附件已用于其他合同，不可跨供应商或跨合同重复挂接',
        code: 'CONTRACT_ASSET_ALREADY_BOUND',
      });
    }
    return asset.id;
  }

  /** 验证已挂在当前合同节点上的存量证据，不再要求当前操作人是原上传者。 */
  private async assertExistingContractDocumentAsset(assetId: string, db: any = this.prisma) {
    const asset = await db.fileAsset.findFirst({
      where: { id: assetId, category: 'contract_document' },
      select: { id: true },
    });
    if (!asset) {
      throw new BadRequestException({
        error: '合同或履约证明附件不存在或文件分类不正确',
        code: 'CONTRACT_ASSET_INVALID',
      });
    }
    return asset.id;
  }

  private assertContractNotClosed(status: string) {
    if ((CLOSED_CONTRACT_STATUSES as readonly string[]).includes(status)) {
      throw new ConflictException({
        error: '合同已验收办结或终止，不可再修改履约记录',
        code: 'CONTRACT_CLOSED',
      });
    }
  }

  private companyWhere(companyFilter: CompanyFilter): CompanyFilter {
    return companyFilter.companyId ? { companyId: companyFilter.companyId } : {};
  }

  private assertContractCanPerform(status: string, signedAssetId?: string | null) {
    this.assertContractNotClosed(status);
    if (!['signed', 'performing'].includes(status)) {
      throw new BadRequestException({
        error: '合同签署后方可登记或修改履约节点',
        code: 'BAD_STATUS',
      });
    }
    this.assertSignedEvidence(signedAssetId);
  }

  private assertSignedEvidence(signedAssetId?: string | null) {
    if (!signedAssetId) {
      throw new BadRequestException({
        error: '合同缺少可核验的签署版文件，不可继续流转',
        code: 'SIGNED_ASSET_REQUIRED',
      });
    }
  }

  private async enrichFulfillmentProofAssets(contracts: any[]) {
    const proofAssetIds = contracts.flatMap((contract) => contract.fulfillments ?? [])
      .map((fulfillment: any) => fulfillment.proofAssetId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const signedAssetIds = contracts
      .map((contract) => contract.signedAssetId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const assetIds = Array.from(new Set([...proofAssetIds, ...signedAssetIds]));
    const assets = assetIds.length > 0
      ? await this.prisma.fileAsset.findMany({
          where: { id: { in: assetIds } },
          select: {
            id: true,
            originalName: true,
            size: true,
            sha256: true,
            mimeType: true,
            createdAt: true,
          },
        })
      : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return contracts.map((contract) => ({
      ...contract,
      signedAsset: contract.signedAssetId
        ? assetById.get(contract.signedAssetId) ?? null
        : null,
      fulfillments: (contract.fulfillments ?? []).map((fulfillment: any) => ({
        ...fulfillment,
        proofAsset: fulfillment.proofAssetId
          ? assetById.get(fulfillment.proofAssetId) ?? null
          : null,
      })),
    }));
  }

  // ─────────────────────────── 查询 ───────────────────────────

  async list(params: { status?: string; q?: string; companyId?: string }) {
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
    const contracts = await this.prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
      take: 200,
    });
    return this.enrichFulfillmentProofAssets(contracts);
  }

  /** :3005 项目管理详情合同 tab：按台账项/项目编号取合同 */
  async listByProject(params: { projectManagementItemId?: string; projectCode?: string; companyId?: string }) {
    if (!params.projectManagementItemId && !params.projectCode) {
      throw new BadRequestException({ error: '缺少项目定位参数', code: 'BAD_PARAMS' });
    }
    const where: any = {};
    if (params.companyId) where.companyId = params.companyId;
    if (params.projectManagementItemId) where.projectManagementItemId = params.projectManagementItemId;
    else if (params.projectCode) where.projectCode = params.projectCode;
    const contracts = await this.prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
    });
    return this.enrichFulfillmentProofAssets(contracts);
  }

  async get(id: string, companyFilter: CompanyFilter) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, ...companyFilter },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!contract) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
    const [enriched] = await this.enrichFulfillmentProofAssets([contract]);
    return enriched;
  }

  // ─────────────────────────── C2 订立 ───────────────────────────

  private normalizedSupplierName(value: string) {
    return value.trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
  }

  /** 定位当前公司的线上项目；本公司 PMI 尚无 BidProject 时才返回 null。 */
  private async resolveCreateProject(
    dto: { projectId?: string; projectCode: string; projectManagementItemId?: string },
    companyFilter: CompanyFilter,
  ) {
    const scopedWhere = this.companyWhere(companyFilter);
    const select = {
      id: true,
      projectCode: true,
      projectManagementItemId: true,
      companyId: true,
    } as const;

    if (dto.projectManagementItemId) {
      const item = await this.prisma.projectManagementItem.findFirst({
        where: { id: dto.projectManagementItemId, ...scopedWhere },
        select: { id: true },
      });
      if (!item) {
        throw new NotFoundException({ error: '项目不存在', code: 'PROJECT_NOT_FOUND' });
      }
    }

    if (dto.projectId) {
      const project = await this.prisma.bidProject.findFirst({
        where: {
          id: dto.projectId,
          ...(dto.projectManagementItemId ? { projectManagementItemId: dto.projectManagementItemId } : {}),
          ...scopedWhere,
        },
        select,
      });
      if (!project) {
        throw new NotFoundException({ error: '项目不存在', code: 'PROJECT_NOT_FOUND' });
      }
      return project;
    }

    if (dto.projectManagementItemId) {
      return this.prisma.bidProject.findFirst({
        where: { projectManagementItemId: dto.projectManagementItemId, ...scopedWhere },
        orderBy: [{ round: 'desc' }, { createdAt: 'desc' }],
        select,
      });
    }

    return this.prisma.bidProject.findFirst({
      where: { projectCode: dto.projectCode.trim(), ...scopedWhere },
      select,
    });
  }

  /** 评审结果/通知书中存的是 BidSupplier.id，须继续解引用户门户使用的 Supplier.id。 */
  private async resolveOnlineContractSupplier(
    projectId: string,
    input: { supplierId?: string; supplierName: string },
  ) {
    const [evaluation, delivery] = await Promise.all([
      this.prisma.bidEvaluationResult.findFirst({
        where: { projectId, recommended: true, rank: 1, disqualified: false },
        orderBy: { generatedAt: 'desc' },
        select: { supplierId: true, supplierName: true },
      }),
      this.prisma.awardLetterDelivery.findFirst({
        where: { projectId, deliveredAt: { not: null } },
        orderBy: { deliveredAt: 'desc' },
        select: { supplierId: true, supplierName: true },
      }),
    ]);
    if (evaluation && delivery && evaluation.supplierId !== delivery.supplierId) {
      throw new ConflictException({
        error: '评审结果与成交通知书中的成交人不一致',
        code: 'CONTRACT_AWARD_CONFLICT',
      });
    }
    const winner = evaluation ?? delivery;
    if (!winner) {
      throw new ConflictException({
        error: '线上项目尚未形成可核验的成交结果',
        code: 'CONTRACT_AWARD_NOT_FOUND',
      });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { id: winner.supplierId, projectId },
      select: {
        id: true,
        supplierId: true,
        supplierName: true,
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!bidSupplier?.supplierId || !bidSupplier.supplier) {
      throw new ConflictException({
        error: '线上成交人尚未关联供应商门户主体',
        code: 'CONTRACT_SUPPLIER_UNLINKED',
      });
    }

    if ((input.supplierId && input.supplierId !== bidSupplier.supplierId)
      || this.normalizedSupplierName(input.supplierName) !== this.normalizedSupplierName(winner.supplierName)) {
      throw new BadRequestException({
        error: '合同供应商与线上成交结果不一致',
        code: 'CONTRACT_SUPPLIER_MISMATCH',
      });
    }
    return { supplierId: bidSupplier.supplierId, supplierName: winner.supplierName.trim() };
  }

  async create(dto: {
    projectId?: string; projectCode: string; projectManagementItemId?: string;
    supplierId?: string; supplierName: string;
    contractType?: string; amount?: number; signDeadline?: string;
    keyTerms?: Record<string, any>;
  }, stamp: { companyId?: string; companyName?: string }) {
    if (!dto.projectCode?.trim() || !dto.supplierName?.trim()) {
      throw new BadRequestException({ error: '项目编号与成交供应商必填', code: 'BAD_PARAMS' });
    }

    const project = await this.resolveCreateProject(dto, stamp);
    let supplier = { supplierId: dto.supplierId, supplierName: dto.supplierName.trim() };
    if (project) {
      supplier = await this.resolveOnlineContractSupplier(project.id, dto);
    } else if (dto.supplierId) {
      const knownSupplier = await this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
        select: { id: true, name: true },
      });
      if (!knownSupplier
        || this.normalizedSupplierName(knownSupplier.name) !== this.normalizedSupplierName(dto.supplierName)) {
        throw new BadRequestException({
          error: '合同供应商与供应商库主体不一致',
          code: 'CONTRACT_SUPPLIER_MISMATCH',
        });
      }
    }

    const contractCode = await this.nextContractCode();
    return this.prisma.contract.create({
      data: {
        contractCode,
        projectId: project?.id ?? null,
        projectCode: dto.projectCode.trim(),
        projectManagementItemId: dto.projectManagementItemId ?? null,
        supplierId: supplier.supplierId ?? 'offline-' + Date.now(), // 明确无线上项目的线下成交可无库内供应商
        supplierName: supplier.supplierName,
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
  async runConsistency(id: string, companyFilter: CompanyFilter): Promise<ConsistencyResult> {
    const scopedWhere = this.companyWhere(companyFilter);
    const contract = await this.get(id, scopedWhere);

    const source = await this.resolveAwardSource(contract);
    const result = checkContractConsistency(
      { supplierName: contract.supplierName, amount: contract.amount != null ? Number(contract.amount) : null },
      source,
    );
    const updated = await this.prisma.contract.updateMany({
      where: { id, ...scopedWhere },
      data: { consistencyResult: result as any },
    });
    if (updated.count !== 1) {
      throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
    }
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
  async submitReview(id: string, operator: ContractActor) {
    const scopedWhere = this.companyWhere(operator);
    const contract = await this.get(id, scopedWhere);
    if (contract.status !== 'drafting') {
      throw new BadRequestException({ error: '仅草拟状态可提交内审', code: 'BAD_STATUS' });
    }
    // 提交内审即先跑一次一致性校验（结果随合同带给内审）
    await this.runConsistency(id, scopedWhere);
    const claimed = await this.prisma.contract.updateMany({
      where: { id, ...scopedWhere, status: 'drafting' },
      data: { status: 'internal_review' },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({ error: '合同状态已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
    }
    return this.get(id, scopedWhere);
  }

  /** 内审（审计法务部）：通过→待登记签署；驳回→回草拟（reviewNote 必填） */
  async review(id: string, dto: { approved: boolean; note?: string }, operator: ContractActor) {
    const scopedWhere = this.companyWhere(operator);
    const contract = await this.get(id, scopedWhere);
    if (contract.status !== 'internal_review') {
      throw new BadRequestException({ error: '合同不在内审状态', code: 'BAD_STATUS' });
    }
    if (!dto.approved && !dto.note?.trim()) {
      throw new BadRequestException({ error: '驳回必须填写内审意见', code: 'NOTE_REQUIRED' });
    }
    // 7.5.4.3 闸门与 sign() 同口径：内审通过前必须先过一致性校验；
    // 通过后仅转待签署，由 sign() 在签署件齐备时落已签署。
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
    const claimed = await this.prisma.contract.updateMany({
      where: { id, ...scopedWhere, status: 'internal_review', updatedAt: contract.updatedAt },
      data: {
        status: dto.approved ? 'approved_for_signing' : 'drafting',
        signedAt: null,
        reviewNote: dto.note?.trim() || contract.reviewNote,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({ error: '合同状态已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
    }
    return this.get(id, scopedWhere);
  }

  /** 登记/修正签署（线下已签回扫） */
  async sign(
    id: string,
    dto: { signedAssetId?: string; signedAt?: string },
    actor: ContractActor,
  ) {
    const scopedWhere = this.companyWhere(actor);
    const contract = await this.get(id, scopedWhere);
    this.assertContractNotClosed(contract.status);
    if (!['approved_for_signing', 'signed'].includes(contract.status)) {
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
    const requestedSignedAssetId = dto.signedAssetId?.trim() || undefined;
    if (!requestedSignedAssetId && !contract.signedAssetId) {
      this.assertSignedEvidence(null);
    }
    return this.prisma.$transaction(async (tx) => {
      const signedAssetId = requestedSignedAssetId
        ? await this.assertContractDocumentAsset(requestedSignedAssetId, id, actor, tx)
        : contract.signedAssetId;
      const signedAt = dto.signedAt ? new Date(dto.signedAt) : new Date();
      const claimed = await tx.contract.updateMany({
        where: {
          id,
          ...scopedWhere,
          status: { in: ['approved_for_signing', 'signed'] },
          updatedAt: contract.updatedAt,
        },
        data: {
          status: 'signed',
          signedAt,
          signedAssetId,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.contract.findFirst({
          where: { id, ...scopedWhere },
          select: { status: true, signedAssetId: true },
        });
        if (!current) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
        this.assertContractNotClosed(current.status);
        throw new ConflictException({ error: '合同版本已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
      }
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CONTRACT_SIGNED',
          resourceType: 'Contract',
          resourceId: id,
          details: {
            username: actor.username ?? null,
            fromStatus: contract.status,
            toStatus: 'signed',
            signedAssetId: signedAssetId ?? contract.signedAssetId ?? null,
            signedAt,
          },
        },
      });
      const updated = await tx.contract.findUnique({ where: { id } });
      if (!updated) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 合同公告（7.5.4.5 宜公开） */
  async publishContractNotice(id: string, companyFilter: CompanyFilter) {
    const contract = await this.get(id, this.companyWhere(companyFilter));
    if (contract.status !== 'signed' && contract.status !== 'performing' && contract.status !== 'accepted') {
      throw new BadRequestException({ error: '合同签署后方可发布合同公告', code: 'BAD_STATUS' });
    }
    this.assertSignedEvidence(contract.signedAssetId);
    const existing = await this.prisma.announcement.findFirst({
      where: {
        relatedProjectCode: contract.projectCode,
        type: 'CONTRACT_NOTICE',
        companyId: contract.companyId,
      },
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
  async generateDraftDocx(id: string, uploaderId: string | undefined, companyFilter: CompanyFilter) {
    const scopedWhere = this.companyWhere(companyFilter);
    const contract = await this.get(id, scopedWhere);
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
        originalName: buildStandardFileName({ code: contract.contractCode, name: contract.projectCode, docType: '合同草稿' }),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'contract_document',
        uploaderId: uploaderId ?? null,
      },
    });
    const attached = await this.prisma.contract.updateMany({
      where: { id, ...scopedWhere, updatedAt: contract.updatedAt },
      data: { draftAssetId: asset.id },
    });
    if (attached.count !== 1) {
      throw new ConflictException({ error: '合同版本已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
    }
    return { fileAssetId: asset.id, objectKey, size: buffer.length };
  }

  // ─────────────────────────── C3 履行与验收 ───────────────────────────

  async addFulfillment(id: string, dto: {
    type: string; title: string; dueDate?: string; amount?: number; note?: string;
  }, actor: ContractActor) {
    if (!FULFILLMENT_TYPES.includes(dto.type as any)) {
      throw new BadRequestException({ error: '节点类型不合法（delivery|payment|acceptance）', code: 'BAD_TYPE' });
    }
    if (!dto.title?.trim()) throw new BadRequestException({ error: '请填写节点名称', code: 'BAD_PARAMS' });
    const scopedWhere = this.companyWhere(actor);
    const contract = await this.get(id, scopedWhere);
    this.assertContractCanPerform(contract.status, contract.signedAssetId);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contract.updateMany({
        where: {
          id,
          ...scopedWhere,
          status: { in: ['signed', 'performing'] },
          updatedAt: contract.updatedAt,
        },
        data: { status: 'performing' },
      });
      if (claimed.count !== 1) {
        const current = await tx.contract.findFirst({
          where: { id, ...scopedWhere },
          select: { status: true, signedAssetId: true },
        });
        if (!current) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
        this.assertContractCanPerform(current.status, current.signedAssetId);
        throw new ConflictException({ error: '合同版本已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
      }

      const fulfillment = await tx.contractFulfillment.create({
        data: {
          contractId: id,
          type: dto.type,
          title: dto.title.trim(),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          amount: dto.amount != null ? dto.amount : null,
          note: dto.note?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CONTRACT_FULFILLMENT_ADDED',
          resourceType: 'ContractFulfillment',
          resourceId: fulfillment.id,
          details: {
            username: actor.username ?? null,
            contractId: id,
            fromStatus: contract.status,
            toStatus: 'performing',
            fulfillmentType: dto.type,
          },
        },
      });
      return fulfillment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateFulfillment(contractId: string, fulfillmentId: string, dto: {
    status?: string; doneDate?: string; amount?: number; proofAssetId?: string; note?: string;
  }, actor: ContractActor) {
    const scopedWhere = this.companyWhere(actor);
    const fulfillment = await this.prisma.contractFulfillment.findFirst({
      where: { id: fulfillmentId, contractId, contract: scopedWhere },
      include: {
        contract: { select: { id: true, status: true, supplierId: true, signedAssetId: true } },
      },
    });
    if (!fulfillment) throw new NotFoundException({ error: '履行节点不存在', code: 'NOT_FOUND' });
    this.assertContractCanPerform(fulfillment.contract.status, fulfillment.contract.signedAssetId);
    if (fulfillment.status === 'done') {
      throw new ConflictException({
        error: '履约节点已完成，凭证和节点内容均不可覆盖',
        code: 'FULFILLMENT_LOCKED',
      });
    }
    if (dto.status === 'done' && !dto.proofAssetId?.trim() && !fulfillment.proofAssetId) {
      throw new BadRequestException({
        error: '完成履约节点前必须上传履约证明',
        code: 'FULFILLMENT_PROOF_REQUIRED',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      let proofAssetId: string | undefined;
      const requestedProofAssetId = dto.proofAssetId?.trim() || undefined;
      if (requestedProofAssetId && requestedProofAssetId === fulfillment.proofAssetId) {
        proofAssetId = await this.assertExistingContractDocumentAsset(requestedProofAssetId, tx);
      } else if (requestedProofAssetId) {
        proofAssetId = await this.assertContractDocumentAsset(requestedProofAssetId, contractId, actor, tx);
      } else if (dto.status === 'done' && fulfillment.proofAssetId) {
        await this.assertExistingContractDocumentAsset(fulfillment.proofAssetId, tx);
      }
      const data = {
        ...(dto.status && ['pending', 'done', 'exception'].includes(dto.status) && { status: dto.status }),
        ...(dto.status === 'done' && { doneDate: dto.doneDate ? new Date(dto.doneDate) : new Date() }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(proofAssetId && { proofAssetId }),
        ...(dto.note !== undefined && { note: dto.note }),
      };
      const claimed = await tx.contractFulfillment.updateMany({
        where: {
          id: fulfillmentId,
          contractId,
          status: { not: 'done' },
          updatedAt: fulfillment.updatedAt,
          contract: { ...scopedWhere, status: { in: ['signed', 'performing'] } },
        },
        data,
      });
      if (claimed.count !== 1) {
        const current = await tx.contractFulfillment.findFirst({
          where: { id: fulfillmentId, contractId, contract: scopedWhere },
          include: {
            contract: { select: { id: true, status: true, supplierId: true, signedAssetId: true } },
          },
        });
        if (!current) throw new NotFoundException({ error: '履行节点不存在', code: 'NOT_FOUND' });
        this.assertContractCanPerform(current.contract.status, current.contract.signedAssetId);
        if (current.status === 'done') {
          throw new ConflictException({
            error: '履约节点已完成，凭证和节点内容均不可覆盖',
            code: 'FULFILLMENT_LOCKED',
          });
        }
        throw new ConflictException({
          error: '履约节点版本已变更，请刷新后重试',
          code: 'FULFILLMENT_VERSION_CHANGED',
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CONTRACT_FULFILLMENT_UPDATED',
          resourceType: 'ContractFulfillment',
          resourceId: fulfillmentId,
          details: {
            username: actor.username ?? null,
            contractId,
            fromStatus: fulfillment.status,
            toStatus: dto.status ?? fulfillment.status,
            proofAssetId: proofAssetId ?? fulfillment.proofAssetId ?? null,
          },
        },
      });
      const updated = await tx.contractFulfillment.findUnique({ where: { id: fulfillmentId } });
      if (!updated) throw new NotFoundException({ error: '履行节点不存在', code: 'NOT_FOUND' });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 签署合同转履行中（首次登记履行节点时自动） */
  async startPerforming(id: string, companyFilter: CompanyFilter) {
    const scopedWhere = this.companyWhere(companyFilter);
    const contract = await this.get(id, scopedWhere);
    this.assertContractCanPerform(contract.status, contract.signedAssetId);
    if (contract.status === 'performing') return contract;

    const claimed = await this.prisma.contract.updateMany({
      where: { id, ...scopedWhere, status: 'signed', updatedAt: contract.updatedAt },
      data: { status: 'performing' },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.contract.findFirst({
        where: { id, ...scopedWhere },
        select: { status: true, signedAssetId: true },
      });
      if (!current) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
      this.assertContractCanPerform(current.status, current.signedAssetId);
      throw new ConflictException({ error: '合同版本已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
    }
    const updated = await this.prisma.contract.findFirst({ where: { id, ...scopedWhere } });
    if (!updated) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
    return updated;
  }

  /**
   * 验收办结（7.6.2）：验收节点完成 → accepted + 履行结果公告（7.6.2.2）。
   * dto.evaluate=true 时同步生成履约评价骨架（evaluationSource=contract，等级由 :3005 供应商评价表填写）。
   */
  async accept(
    id: string,
    dto: { note?: string; proofAssetId?: string; publishNotice?: boolean },
    actor: ContractActor,
  ) {
    const scopedWhere = this.companyWhere(actor);
    const contract = await this.get(id, scopedWhere);
    this.assertContractNotClosed(contract.status);
    if (!['signed', 'performing'].includes(contract.status)) {
      throw new BadRequestException({ error: '合同签署/履行中才可验收办结', code: 'BAD_STATUS' });
    }
    this.assertSignedEvidence(contract.signedAssetId);
    const existing = contract.fulfillments.find(
      (fulfillment: any) => fulfillment.type === 'acceptance'
        && fulfillment.status === 'done'
        && Boolean(fulfillment.proofAssetId),
    );
    const requestedProofAssetId = dto.proofAssetId?.trim() || undefined;
    if (existing && requestedProofAssetId && requestedProofAssetId !== existing.proofAssetId) {
      throw new ConflictException({
        error: '验收节点已完成，验收凭证不可覆盖',
        code: 'FULFILLMENT_LOCKED',
      });
    }
    if (!requestedProofAssetId && !existing) {
      throw new BadRequestException({
        error: '验收办结前必须上传验收证明，或先完成带证明的验收节点',
        code: 'ACCEPTANCE_PROOF_REQUIRED',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      if (existing?.proofAssetId) {
        await this.assertExistingContractDocumentAsset(existing.proofAssetId, tx);
      }
      const suppliedProofAssetId = requestedProofAssetId && !existing
        ? await this.assertContractDocumentAsset(requestedProofAssetId, id, actor, tx)
        : undefined;
      const claimed = await tx.contract.updateMany({
        where: {
          id,
          ...scopedWhere,
          status: { in: ['signed', 'performing'] },
          updatedAt: contract.updatedAt,
        },
        data: { status: 'accepted' },
      });
      if (claimed.count !== 1) {
        const current = await tx.contract.findFirst({
          where: { id, ...scopedWhere },
          select: { status: true },
        });
        if (!current) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
        this.assertContractNotClosed(current.status);
        throw new ConflictException({ error: '合同版本已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
      }

      let acceptance = existing;
      if (!acceptance && suppliedProofAssetId) {
        const pendingAcceptance = contract.fulfillments.find(
          (fulfillment: any) => fulfillment.type === 'acceptance' && fulfillment.status !== 'done',
        );
        if (pendingAcceptance) {
          const acceptanceClaim = await tx.contractFulfillment.updateMany({
            where: {
              id: pendingAcceptance.id,
              contractId: id,
              contract: scopedWhere,
              status: { not: 'done' },
              updatedAt: pendingAcceptance.updatedAt,
            },
            data: {
              status: 'done',
              doneDate: new Date(),
              proofAssetId: suppliedProofAssetId,
              note: dto.note?.trim() || pendingAcceptance.note || null,
            },
          });
          if (acceptanceClaim.count !== 1) {
            throw new ConflictException({
              error: '验收节点版本已变更，请刷新后重试',
              code: 'FULFILLMENT_VERSION_CHANGED',
            });
          }
          acceptance = await tx.contractFulfillment.findUnique({ where: { id: pendingAcceptance.id } });
        } else {
          acceptance = await tx.contractFulfillment.create({
            data: {
              contractId: id,
              type: 'acceptance',
              title: '合同验收',
              status: 'done',
              doneDate: new Date(),
              proofAssetId: suppliedProofAssetId,
              note: dto.note?.trim() || null,
            },
          });
        }
      }
      if (!acceptance?.proofAssetId) {
        throw new BadRequestException({
          error: '验收办结前必须具备可核验的验收证明',
          code: 'ACCEPTANCE_PROOF_REQUIRED',
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CONTRACT_ACCEPTED',
          resourceType: 'Contract',
          resourceId: id,
          details: {
            username: actor.username ?? null,
            fromStatus: contract.status,
            toStatus: 'accepted',
            acceptanceFulfillmentId: acceptance.id,
            proofAssetId: acceptance.proofAssetId,
          },
        },
      });

      // 履行结果公告（默认发布，dto 可关）
      let announcementId: string | null = null;
      if (dto.publishNotice !== false) {
        const dup = await tx.announcement.findFirst({
          where: {
            relatedProjectCode: contract.projectCode,
            type: 'PERFORMANCE_NOTICE',
            companyId: contract.companyId,
          },
          select: { id: true },
        });
        if (!dup) {
          const ann = await tx.announcement.create({
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

      const updated = await tx.contract.findUnique({ where: { id } });
      if (!updated) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
      return { contract: updated, announcementId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 终止（协商解除/违约终止），理由必填 */
  async terminate(id: string, reason: string, actor: ContractActor) {
    if (!reason?.trim()) throw new BadRequestException({ error: '请填写终止理由', code: 'REASON_REQUIRED' });
    const scopedWhere = this.companyWhere(actor);
    const contract = await this.get(id, scopedWhere);
    this.assertContractNotClosed(contract.status);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contract.updateMany({
        where: {
          id,
          ...scopedWhere,
          status: { notIn: ['accepted', 'terminated'] },
          updatedAt: contract.updatedAt,
        },
        data: { status: 'terminated', reviewNote: reason.trim() },
      });
      if (claimed.count !== 1) {
        const current = await tx.contract.findFirst({
          where: { id, ...scopedWhere },
          select: { status: true },
        });
        if (!current) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
        this.assertContractNotClosed(current.status);
        throw new ConflictException({ error: '合同版本已变更，请刷新后重试', code: 'CONTRACT_VERSION_CHANGED' });
      }
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'CONTRACT_TERMINATED',
          resourceType: 'Contract',
          resourceId: id,
          details: {
            username: actor.username ?? null,
            fromStatus: contract.status,
            toStatus: 'terminated',
            reason: reason.trim(),
          },
        },
      });
      const updated = await tx.contract.findUnique({ where: { id } });
      if (!updated) throw new NotFoundException({ error: '合同不存在', code: 'NOT_FOUND' });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
