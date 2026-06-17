import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BidDocumentService } from '../announcement/bid-document.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { isSupplierChangeAllowedField } from '../supplier/supplier-change-fields';
import { encryptBuffer, streamToBuffer } from '../announcement/bid-document.crypto';
import { minioClient, MINIO_BUCKET } from '../upload/minio.client';

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
};

@Injectable()
export class SupplierPortalService {
  constructor(
    private prisma: PrismaService,
    private bidDocumentService: BidDocumentService,
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
      select: { level: true, score: true, overallScore: true },
    });

    const total = evaluations.length;
    const avgScore = total > 0
      ? evaluations.reduce((sum, e) => sum + Number(e.overallScore), 0) / total
      : 0;
    const levelCounts = {
      A: evaluations.filter(e => e.level === 'A').length,
      B: evaluations.filter(e => e.level === 'B').length,
      C: evaluations.filter(e => e.level === 'C').length,
      D: evaluations.filter(e => e.level === 'D').length,
    };

    return { total, avgScore: Math.round(avgScore * 10) / 10, levelCounts };
  }

  // ─── Bid Projects (招标机会 — supplier-facing) ───
  // 仅返回项目公开字段 + 投标方数量。绝不暴露其他投标方身份、开标记录、
  // 专家名单与评分等评审内部信息（这些是 BidController 受角色保护的原因）。
  async listBidProjects(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [total, items] = await Promise.all([
      this.prisma.bidProject.count(),
      this.prisma.bidProject.findMany({
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
          stage: true,
          riskNote: true,
          createdAt: true,
          _count: { select: { suppliers: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async getBidProject(id: string) {
    return this.prisma.bidProject.findUnique({
      where: { id },
      select: {
        id: true,
        projectCode: true,
        name: true,
        procurementMethod: true,
        openTime: true,
        deadline: true,
        stage: true,
        riskNote: true,
        createdAt: true,
        clarifications: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true, question: true, issuer: true, reply: true, createdAt: true },
        },
        _count: { select: { suppliers: true } },
      },
    });
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
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });

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
      select: { projectCode: true },
    });
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });

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
        select: { id: true, stage: true, deadline: true },
      }),
    ]);

    if (!supplier) throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '供应商未通过审核，无法投标', code: 'NOT_APPROVED' });
    }
    if (!project) throw new BadRequestException({ error: '招标项目不存在', code: 'PROJECT_NOT_FOUND' });
    if (project.stage !== 'SUBMIT') {
      throw new BadRequestException({ error: '当前项目不在投递阶段', code: 'PROJECT_NOT_SUBMITTING' });
    }
    if (project.deadline.getTime() < Date.now()) {
      throw new BadRequestException({ error: '投递截止时间已过', code: 'DEADLINE_PASSED' });
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

    const { supplier } = await this.assertCanSubmitBid(supplierId, projectId);
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
    ]);

    // ── Layer B: encrypt submitted bid files at rest ──
    const assetIds = [data.technicalFileAssetId, data.businessFileAssetId, data.coverLetterAssetId].filter(Boolean) as string[];
    const sealedKeys: Record<string, string> = {};
    const plaintextBackups: Map<string, Buffer> = new Map();

    try {
      for (const assetId of assetIds) {
        const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
        if (!asset) continue;

        const objStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
        const plaintext = await streamToBuffer(objStream);
        plaintextBackups.set(assetId, plaintext);

        const { ciphertext, decryptKey } = encryptBuffer(plaintext);
        sealedKeys[assetId] = decryptKey;

        await minioClient.putObject(MINIO_BUCKET, asset.key, ciphertext, ciphertext.length, {
          'Content-Type': 'application/octet-stream',
        });

        await this.prisma.fileAsset.update({
          where: { id: assetId },
          data: { encrypted: true },
        });
      }
    } catch (err) {
      // Rollback: restore plaintext for any files we may have overwritten
      for (const [assetId, plaintext] of plaintextBackups) {
        try {
          const asset = await this.prisma.fileAsset.findUnique({ where: { id: assetId } });
          if (asset) {
            await minioClient.putObject(MINIO_BUCKET, asset.key, plaintext, plaintext.length, {
              'Content-Type': asset.mimeType,
            });
            await this.prisma.fileAsset.update({
              where: { id: assetId },
              data: { encrypted: false },
            });
          }
        } catch (_) { /* best-effort rollback */ }
      }
      throw err;
    }

    const now = new Date();

    let submission;
    if (existing) {
      // Update draft to submitted
      submission = await this.prisma.supplierBidSubmission.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: 'submitted',
          submittedAt: now,
          technicalSealedKey: data.technicalFileAssetId ? sealedKeys[data.technicalFileAssetId] ?? null : null,
          businessSealedKey: data.businessFileAssetId ? sealedKeys[data.businessFileAssetId] ?? null : null,
          coverLetterSealedKey: data.coverLetterAssetId ? sealedKeys[data.coverLetterAssetId] ?? null : null,
        },
      });
    } else {
      // Create new submission
      submission = await this.prisma.supplierBidSubmission.create({
        data: {
          supplierId,
          projectId,
          ...data,
          status: 'submitted',
          submittedAt: now,
          technicalSealedKey: data.technicalFileAssetId ? sealedKeys[data.technicalFileAssetId] ?? null : null,
          businessSealedKey: data.businessFileAssetId ? sealedKeys[data.businessFileAssetId] ?? null : null,
          coverLetterSealedKey: data.coverLetterAssetId ? sealedKeys[data.coverLetterAssetId] ?? null : null,
        },
      });
    }

    // Also create/update BidSupplier record for bid management
    const existingBidSupplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierName: supplier.name },
    });

    if (existingBidSupplier) {
      await this.prisma.bidSupplier.update({
        where: { id: existingBidSupplier.id },
        data: { supplierId, submitStatus: '已提交', encryptStatus: '密文已校验' },
      });
    } else {
      const receiptNo = `TB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
      await this.prisma.bidSupplier.create({
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

    return submission;
  }

  async saveBidDraft(supplierId: string, projectId: string, data: BidSubmissionData) {
    const { supplier } = await this.assertCanSaveBidDraft(supplierId, projectId);
    await this.assertBidFileAssetsOwnedByUser(supplier.userId, [
      data.technicalFileAssetId,
      data.businessFileAssetId,
      data.coverLetterAssetId,
    ]);

    const existing = await this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });

    if (existing) {
      return this.prisma.supplierBidSubmission.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.supplierBidSubmission.create({
      data: { supplierId, projectId, ...data, status: 'draft' },
    });
  }

  async getMySubmissions(supplierId: string) {
    return this.prisma.supplierBidSubmission.findMany({
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
  }

  async getSubmission(supplierId: string, projectId: string) {
    return this.prisma.supplierBidSubmission.findUnique({
      where: { supplierId_projectId: { supplierId, projectId } },
    });
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
    if (project.stage !== 'SUBMIT') {
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_APPLICATION_RESUBMITTED', target: '目录供货申请', detail: { applicationId, status: app.status } } });
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_COUNTER_ACCEPTED', target: '目录供货申请', detail: { applicationId, counterPrice: Number(app.counterPrice) } } });
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
    await this.prisma.auditLog.create({ data: { userId, action: 'CATALOG_APPLICATION_WITHDRAWN', target: '目录供货申请', detail: { applicationId } } });
    return updated;
  }

  /** 通知审核管理员（议价/退回的发起人）。若无 reviewedBy 则静默跳过。 */
  private async notifyReviewer(app: any, title: string, content: string) {
    if (!app.reviewedBy) return;
    await this.prisma.notification.create({ data: { userId: app.reviewedBy, type: 'CATALOG_APPLICATION', title, content, link: '/supplier/catalog-review' } });
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
      contacts: { score: number; max: number; filled: number; total: number; missing: string[] };
      qualifications: { score: number; max: number; filled: number; total: number; missing: string[] };
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
    let contactFilled = 0;
    const contactTotal = 1;
    const contactMissing: string[] = [];
    if (supplier.contacts?.length > 0) {
      contactScore += 12; contactFilled = 1;
      const hasPrimary = supplier.contacts.some((c: any) => c.isPrimary);
      if (hasPrimary) contactScore += 8; else contactMissing.push('主要联系人');
    } else {
      contactMissing.push('联系人');
    }
    missing.push(...contactMissing);

    // Qualifications (30 points)
    let qualScore = 0;
    const qualMax = 30;
    let qualFilled = 0;
    const qualTotal = 1;
    const qualMissing: string[] = [];
    if (supplier.qualifications?.length > 0) {
      qualScore += 15; qualFilled = 1;
      const hasLicense = supplier.qualifications.some((q: any) => q.type === '营业执照');
      if (hasLicense) qualScore += 15; else qualMissing.push('营业执照');
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
        contacts: { score: contactScore, max: contactMax, filled: contactFilled, total: contactTotal, missing: contactMissing },
        qualifications: { score: qualScore, max: qualMax, filled: qualFilled, total: qualTotal, missing: qualMissing },
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
}
