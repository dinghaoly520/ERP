import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto } from '../supplier/dto/create-contact.dto';
import { CreateQualificationDto } from '../supplier/dto/create-qualification.dto';
import { CreateChangeRequestDto } from '../supplier/dto/create-change-request.dto';
import { isSupplierChangeAllowedField } from '../supplier/supplier-change-fields';

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
  constructor(private prisma: PrismaService) {}

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
  async listBidProjects() {
    return this.prisma.bidProject.findMany({
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
    });
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
          select: { id: true, question: true, issuer: true, reply: true, createdAt: true },
        },
        _count: { select: { suppliers: true } },
      },
    });
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

  private calculateProfileCompleteness(supplier: any): { score: number; missing: string[] } {
    let score = 0
    const total = 100
    const missing: string[] = []

    // Basic info (40 points)
    if (supplier.name) score += 8; else missing.push('企业名称')
    if (supplier.creditCode) score += 8; else missing.push('统一社会信用代码')
    if (supplier.enterpriseType) score += 6; else missing.push('企业类型')
    if (supplier.legalPerson) score += 6; else missing.push('法定代表人')
    if (supplier.registeredAddress) score += 6; else missing.push('注册地址')
    if (supplier.businessScope) score += 6; else missing.push('经营范围')

    // Contacts (20 points)
    if (supplier.contacts?.length > 0) {
      score += 12
      const hasPrimary = supplier.contacts.some((c: any) => c.isPrimary)
      if (hasPrimary) score += 8; else missing.push('主要联系人')
    } else {
      missing.push('联系人')
    }

    // Qualifications (30 points)
    if (supplier.qualifications?.length > 0) {
      score += 15
      const hasLicense = supplier.qualifications.some((q: any) => q.type === '营业执照')
      if (hasLicense) score += 15; else missing.push('营业执照')
    } else {
      missing.push('资质材料')
    }

    // Classification (10 points)
    if (supplier.classificationId) score += 10; else missing.push('供应商分类')

    return { score, missing }
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
