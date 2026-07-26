import { Injectable, BadRequestException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ConvertToRegularDto } from './dto/convert-to-regular.dto';
import { isSupplierChangeAllowedField } from '../supplier/supplier-change-fields';
import { encryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';
import { wrapKey } from '../common/crypto/envelope-crypto';
import { SignatureService } from '../common/crypto/signature.service';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';
import { BidBackupService, BackupFileRole, StagedBackup } from '../bid-backup/bid-backup.service';
import { BidGateway } from '../bid/bid.gateway';
import * as crypto from 'crypto';

/** 供应商投标提交/草稿共用的可持久化字段 */
type BidSubmissionData = {
  bidPrice?: string;
  deliveryPeriod?: string;
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
};

/**
 * 仅保留供应商可提交的合法字段，杜绝 Mass Assignment。
 * 原先 controller 用内联类型透传 body（无 class-validator DTO，ValidationPipe whitelist 不生效），
 * `...data` 直接铺进 Prisma data，可被注入 supplierId（冒名投递）/ status:'submitted'（绕过加密+验签+阶段门控）/
 * submittedAt / signedAt 等。此处显式枚举白名单，剥离一切越权字段。
 */
function pickBidSubmissionFields(data: BidSubmissionData) {
  return {
    bidPrice: data.bidPrice,
    deliveryPeriod: data.deliveryPeriod,
    technicalFile: data.technicalFile,
    businessFile: data.businessFile,
    coverLetter: data.coverLetter,
    technicalFileAssetId: data.technicalFileAssetId,
    businessFileAssetId: data.businessFileAssetId,
    coverLetterAssetId: data.coverLetterAssetId,
    bidBondAssetId: data.bidBondAssetId,
    fileHash: data.fileHash,
    signature: data.signature,
  };
}

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

@Injectable()
export class SupplierPortalService {
  constructor(
    private prisma: PrismaService,
    private bidDocumentService: BidDocumentService,
    private signatureService: SignatureService,
    private bidBackup: BidBackupService,
    @Optional() private readonly gateway?: BidGateway,
  ) {}

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
  // 仅返回项目公开字段 + 投标方数量。绝不暴露其他投标方身份、开标记录、
  // 专家名单与评分等评审内部信息（这些是 BidController 受角色保护的原因）。
  // 仅返回截止时间未到的项目；公告项目=accessScope OPEN，受邀项目=INVITED/DESIGNATED。
  async listBidProjects(
    page = 1,
    pageSize = 20,
    filters: { search?: string; scope?: string } = {},
  ) {
    const skip = (page - 1) * pageSize;
    const now = new Date();
    const kw = filters.search?.trim();
    const baseWhere: any = {
      deadline: { gt: now }, // 仅展示截止时间未到的项目
    };
    if (kw) {
      baseWhere.OR = [
        { name: { contains: kw, mode: 'insensitive' } as any },
        { projectCode: { contains: kw, mode: 'insensitive' } as any },
      ];
    }

    // scope 过滤：公告项目=OPEN，受邀项目=INVITED|DESIGNATED
    let scopeProjectIds: string[] | undefined;
    if (filters.scope) {
      const scopeValues = filters.scope === 'OPEN'
        ? ['OPEN']
        : ['INVITED', 'DESIGNATED'];
      const docs = await this.prisma.bidDocument.findMany({
        where: { accessScope: { in: scopeValues }, bidProjectId: { not: null } },
        select: { bidProjectId: true },
      });
      scopeProjectIds = docs.map(d => d.bidProjectId!).filter(Boolean);
      if (scopeProjectIds.length === 0) {
        return { total: 0, page, pageSize, items: [], scopeCounts: { open: 0, invited: 0 } };
      }
      baseWhere.id = { in: scopeProjectIds };
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

    // 按 scope 分组计数：基于 BidProject（deadline > now）+ BidDocument accessScope，
    // 保证"全部"=所有未到期项目数，与 total 一致；公告/受邀按 BidDocument 归因。
    const allProjectIds = (
      await this.prisma.bidProject.findMany({
        where: { deadline: { gt: now } },
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

    return { total, page, pageSize, items: enrichedItems, scopeCounts };
  }

  async getBidProject(id: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: {
        id: true,
        projectCode: true,
        name: true,
        procurementMethod: true,
        openTime: true,
        deadline: true,
        downloadDeadline: true,
        stage: true,
        riskNote: true,
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
        _count: { select: { suppliers: true } },
      },
    });
    if (project) {
      // 脱敏：供应商提问(type=question)的 issuer 含竞对企业名，开标前属保密信息（防串标/围标）；
      // 管理端发起的澄清/通知(type=clarification 等)保留 issuer。
      project.clarifications = project.clarifications.map((c) => ({
        ...c,
        issuer: c.type === 'question' ? '供应商' : c.issuer,
      }));

      // 富化：查找关联的招标公告内容（relatedProjectCode + type=BID_NOTICE）
      const announcement = await this.prisma.announcement.findFirst({
        where: {
          relatedProjectCode: project.projectCode,
          type: 'BID_NOTICE',
        },
        select: { title: true, content: true, summary: true, publishDate: true, metadata: true },
      });
      (project as any).announcement = announcement;
    }
    return project;
  }

  /**
   * 供应商提问（答疑）
   */
  async createQuestion(supplierId: string, projectId: string, dto: CreateQuestionDto) {
    // P2: 阶段门控 — 归档后不可提问
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (project?.stage === 'ARCHIVED') {
      throw new BadRequestException({ error: '项目已归档，无法提问', code: 'PROJECT_ARCHIVED' });
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
    // P2：停用/黑名单供应商不得发起答疑（即便仍残留 bidSupplier 记录）。
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '当前账号状态不允许发起答疑', code: 'NOT_APPROVED' });
    }

    // Verify the supplier is registered for this project
    const bidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
    });
    if (!bidSupplier) throw new BadRequestException({ error: '您未参与该项目投标', code: 'NOT_PROJECT_SUPPLIER' });

    return this.prisma.bidClarification.create({
      data: {
        projectId,
        type: 'question',
        question: dto.question,
        issuer: supplier.name,
        supplierName: supplier.name,
        supplierId: supplier.id,
        status: '待回复',
        fileAssetId: dto.fileAssetId ?? null,
      },
    });
  }

  /**
   * 根据招标项目 ID 查找关联的招标文件（通过公告的 relatedProjectCode 关联），
   * 返回当前供应商的访问权限状态。无关联文件时返回 null。
   */
  async getBidProjectDocument(projectId: string, supplierId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { projectCode: true, downloadDeadline: true },
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

    // 查找关联的招标公告（BID_NOTICE）
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        relatedProjectCode: project.projectCode,
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
        select: { id: true, projectCode: true, stage: true, deadline: true },
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
    // G3 权威兜底：未发布招标公告则供应商无法获取招标文件，禁止投递
    // （与 openSubmission 的 UX 前置拦截并存；棘轮化后 DOWNLOAD 阶段即可投递，此为唯一权威闸门）
    const notice = await this.prisma.announcement.findFirst({
      where: { relatedProjectCode: project.projectCode, type: 'BID_NOTICE', status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!notice) {
      throw new BadRequestException({ error: '该项目尚未发布招标公告，暂无法投递', code: 'BID_NOTICE_REQUIRED' });
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
    const self = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { isTemporary: true, temporaryExpiresAt: true },
    });
    if (self?.isTemporary && self.temporaryExpiresAt && self.temporaryExpiresAt < new Date()) {
      throw new BadRequestException({ error: '临时供应商权限已过期，无法投标', code: 'TEMPORARY_EXPIRED' });
    }

    // P0-1：前端「完整标书/拆分文件」字段归一到三角色契约，否则 pickBidSubmissionFields 丢弃 → 标书丢失 → 流标。
    normalizeBidFileAssets(data);

    const { supplier } = await this.assertCanSubmitBid(supplierId, projectId);
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
      data.bidBondAssetId,
    ]);

    // ── Layer C: SM2 digital signature verification (anti-repudiation) ──
    // TODO (Phase 6): 当前前端 BidSubmit.vue 未实现 SM2 客户端签名，
    // 因此 signature/fileHash 始终为空，此验证跳过。
    // 需在客户端实现：计算标书文件 SHA-256 → 用供应商 SM2 私钥签名 → 随提交发送。
    if (data.signature && data.fileHash) {
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

    try {
      for (const assetId of assetIds) {
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
        if (!asset) continue;

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
    } catch (err) {
      // Clean up any newly written sealed files on failure
      for (const path of newlySealedPaths) {
        try {
          await minioClient.removeObject(MINIO_BUCKET, path);
        } catch (_) { /* best-effort cleanup */ }
      }
      throw err;
    }

    const now = new Date();

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
              status: 'submitted',
              submittedAt: now,
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
              status: 'submitted',
              submittedAt: now,
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
            data: { supplierId, submitStatus: '已提交', encryptStatus: '密文已校验' },
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
              encryptStatus: '密文已校验',
              receiptNo,
            },
          });
        }

        // ── 固化未解密备份：把封标时 staged 的密文备份写入 BidFileBackup（事务内，幂等 upsert）──
        for (const staged of stagedBackups) {
          await this.bidBackup.persistBackup(tx, staged, { projectId, supplierId, receiptNo, submittedAt: now, backupSource: 'submission' });
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

  async getMySubmissions(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });
    const submissions = await this.prisma.supplierBidSubmission.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: {
            id: true, projectCode: true, name: true,
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
      }
    }
    return submissions;
  }

  async getSubmission(supplierId: string, projectId: string) {
    const sub = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
    // P0-1：前端 BidSubmit.vue 按 fullBidFileAssetId/coverLetterFileAssetId 回读草稿——回传别名避免回显丢文件。
    if (sub) {
      (sub as any).fullBidFileAssetId = sub.technicalFileAssetId;
      (sub as any).coverLetterFileAssetId = sub.coverLetterAssetId;
    }
    return sub;
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
      select: { stage: true, name: true },
    });
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });
    if (project.stage !== 'DOWNLOAD' && project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '项目已进入开标或后续阶段，无法撤回', code: 'PROJECT_ALREADY_OPENING' });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplierBidSubmission.update({
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
          result: '供应商在投递截止前撤回标书',
          riskFlag: '无',
        },
      });

      return updated;
    });
  }

  // ─── 开标确认（供应商侧）───

  async getMyOpeningRecord(supplierId: string, projectId: string) {
    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { supplierId, projectId } });
    if (!bidSupplier) return null;
    return this.prisma.bidOpeningRecord.findFirst({
      where: { projectId, bidSupplierId: bidSupplier.id },
    });
  }

  async confirmOpening(supplierId: string, projectId: string) {
    // P0: 阶段门控 — 仅在开标阶段可确认唱标
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || project.stage !== 'OPENING') {
      throw new BadRequestException({ error: '项目不在开标阶段，无法确认', code: 'PROJECT_NOT_OPENING' });
    }

    const bidSupplier = await this.prisma.bidSupplier.findFirst({ where: { supplierId, projectId } });
    if (!bidSupplier) throw new BadRequestException({ error: '投标记录不存在', code: 'BID_SUPPLIER_NOT_FOUND' });
    if (bidSupplier.decryptStatus !== 'SUCCESS') {
      throw new BadRequestException({ error: '标书尚未解密成功', code: 'NOT_DECRYPTED' });
    }

    // Wave 5-1：状态门——仅待确认态的记录可确认（与 host 侧 R7 状态机对称；UI 已门控，此为 API 防线）。
    // 否则直调 API 可把「异议已处理-退回」（bidSupplier=EXCEPTION）翻回 CONFIRMED/供应商已确认，
    // 让被例外标记的供应商逃脱；DISPUTED 态也可被 confirm 覆盖。
    // 「待确认」为旧值（种子/历史数据），与「待供应商确认」同为待确认态（供应商端 UI 两者都接受，
    // host 侧 I1 重录门同样两者放行），一并视为可操作。
    const PENDING_CONFIRM = ['待供应商确认', '待确认'];
    const record = await this.prisma.bidOpeningRecord.findFirst({ where: { projectId, bidSupplierId: bidSupplier.id } });
    if (!record || !PENDING_CONFIRM.includes(record.confirmStatus)) {
      throw new BadRequestException({ error: '当前开标记录不可确认（仅待供应商确认状态可操作）', code: 'RECORD_NOT_CONFIRMABLE' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bidOpeningRecord.updateMany({
        where: { projectId, bidSupplierId: bidSupplier.id },
        data: { confirmStatus: '供应商已确认', confirmedAt: new Date() },
      });
      await tx.bidSupplier.update({ where: { id: bidSupplier.id }, data: { confirmStatus: 'CONFIRMED' } });
      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '供应商', target: bidSupplier.supplierName,
          action: '确认唱标信息', result: '供应商确认开标记录无误', riskFlag: '无',
        },
      });
    });
    this.gateway?.notifyOpeningConfirmed(projectId, supplierId, {
      projectId, supplierId, supplierName: bidSupplier.supplierName, timestamp: Date.now(),
    });
    return { success: true };
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

  private calculateProfileCompleteness(supplier: any): {
    score: number;
    missing: string[];
    categories: {
      basic: { score: number; max: number; filled: number; total: number; missing: string[] };
      contacts: { score: number; max: number; filled: number; total: number; missing: string[]; count: number; hasPrimary: boolean };
      qualifications: { score: number; max: number; filled: number; total: number; missing: string[]; count: number; hasLicense: boolean };
      classification: { score: number; max: number };
    };
  } {
    const missing: string[] = [];

    // Basic info (40 points)
    let basicScore = 0;
    const basicMax = 40;
    const basicMissing: string[] = [];
    const basicTotal = 6;
    let basicFilled = 0;
    if (supplier.name) { basicScore += 8; basicFilled++; } else basicMissing.push('企业名称');
    if (supplier.creditCode) { basicScore += 8; basicFilled++; } else basicMissing.push('统一社会信用代码');
    if (supplier.enterpriseType) { basicScore += 6; basicFilled++; } else basicMissing.push('企业类型');
    if (supplier.legalPerson) { basicScore += 6; basicFilled++; } else basicMissing.push('法定代表人');
    if (supplier.registeredAddress) { basicScore += 6; basicFilled++; } else basicMissing.push('注册地址');
    if (supplier.businessScope) { basicScore += 6; basicFilled++; } else basicMissing.push('经营范围');
    missing.push(...basicMissing);

    // Contacts (20 points)
    let contactScore = 0;
    const contactMax = 20;
    const contactCount: number = supplier.contacts?.length || 0;
    const contactFilled = contactCount;
    const contactTotal = Math.max(contactCount, 1);
    let contactHasPrimary = false;
    const contactMissing: string[] = [];
    if (contactCount > 0) {
      contactScore += 12;
      contactHasPrimary = supplier.contacts.some((c: any) => c.isPrimary);
      if (contactHasPrimary) contactScore += 8; else contactMissing.push('主要联系人');
    } else {
      contactMissing.push('联系人');
    }
    missing.push(...contactMissing);

    // Qualifications (30 points)
    let qualScore = 0;
    const qualMax = 30;
    const qualCount: number = supplier.qualifications?.length || 0;
    const qualFilled = qualCount;
    const qualTotal = Math.max(qualCount, 1);
    let qualHasLicense = false;
    const qualMissing: string[] = [];
    if (qualCount > 0) {
      qualScore += 15;
      qualHasLicense = supplier.qualifications.some((q: any) => q.type === '营业执照');
      if (qualHasLicense) qualScore += 15; else qualMissing.push('营业执照');
    } else {
      qualMissing.push('资质材料');
    }
    missing.push(...qualMissing);

    // Classification (10 points)
    let classScore = 0;
    if (supplier.classificationId) classScore = 10; else { classScore = 0; missing.push('供应商分类'); }

    const score = basicScore + contactScore + qualScore + classScore;

    return {
      score,
      missing,
      categories: {
        basic: { score: basicScore, max: basicMax, filled: basicFilled, total: basicTotal, missing: basicMissing },
        contacts: { score: contactScore, max: contactMax, filled: contactFilled, total: contactTotal, missing: contactMissing, count: contactCount, hasPrimary: contactHasPrimary },
        qualifications: { score: qualScore, max: qualMax, filled: qualFilled, total: qualTotal, missing: qualMissing, count: qualCount, hasLicense: qualHasLicense },
        classification: { score: classScore, max: 10 },
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
}
