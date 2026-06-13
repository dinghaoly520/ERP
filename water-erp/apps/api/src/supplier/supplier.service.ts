import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { CreateClassificationDto, UpdateClassificationDto } from './dto/create-classification.dto';
import { isSupplierChangeAllowedField } from './supplier-change-fields';

@Injectable()
export class SupplierService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async register(dto: RegisterSupplierDto) {
    // 检查信用代码是否重复
    const existingCreditCode = await this.prisma.supplier.findUnique({
      where: { creditCode: dto.creditCode },
    });
    if (existingCreditCode) {
      throw new BadRequestException({ error: '统一社会信用代码已存在', code: 'DUPLICATE_CREDIT_CODE' });
    }

    // 检查企业名称是否重复（标准化）
    const normalizedName = dto.name.trim().toLowerCase();
    const existingName = await this.prisma.supplier.findUnique({
      where: { normalizedName },
    });
    if (existingName) {
      throw new BadRequestException({ error: '企业名称已存在', code: 'DUPLICATE_NAME' });
    }

    // 检查用户名是否重复
    const existingUser = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingUser) {
      throw new BadRequestException({ error: '用户名已存在', code: 'DUPLICATE_USERNAME' });
    }

    // 创建用户和供应商 — 事务保证原子性
    const { user, supplier } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          displayName: dto.displayName,
          email: dto.email,
          passwordHash: hashSync(dto.password, 10),
          role: 'supplier',
          isActive: false, // 待审核后激活
        },
      });

      const supplier = await tx.supplier.create({
        data: {
          userId: user.id,
          name: dto.name,
          normalizedName,
          creditCode: dto.creditCode,
          enterpriseType: dto.enterpriseType,
          legalPerson: dto.legalPerson,
          registeredAddress: dto.registeredAddress,
          businessScope: dto.businessScope,
          contacts: {
            create: dto.contacts.map(c => ({
              name: c.name,
              phone: c.phone,
              email: c.email,
              isPrimary: c.isPrimary,
            })),
          },
          qualifications: {
            create: dto.qualifications.map(q => ({
              type: q.type,
              name: q.name,
              fileUrl: q.fileUrl,
              validFrom: q.validFrom ? new Date(q.validFrom) : undefined,
              validTo: q.validTo ? new Date(q.validTo) : undefined,
            })),
          },
        },
        include: {
          contacts: true,
          qualifications: true,
        },
      });

      return { user, supplier };
    });

    return { user, supplier };
  }

  async list(params: { status?: string; classificationId?: string; search?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.classificationId) {
      where.classificationId = params.classificationId;
    }
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { creditCode: { contains: params.search } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          classification: true,
          contacts: { where: { isPrimary: true } },
          _count: { select: { evaluations: true } },
        },
      }),
    ]);

    return { total, page, pageSize, items };
  }

  async get(id: string) {
    return this.prisma.supplier.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true } },
        classification: true,
        contacts: true,
        qualifications: true,
        evaluations: { orderBy: { createdAt: 'desc' }, take: 10 },
        changeRecords: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  async getRegisterStatus(userId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, name: true, status: true, returnReason: true, rejectReason: true },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    return supplier;
  }

  async approve(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id }, include: { user: true } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    // 更新供应商状态和用户激活状态
    await this.prisma.$transaction([
      this.prisma.supplier.update({
        where: { id },
        data: { status: 'APPROVED', returnReason: null, rejectReason: null },
      }),
      this.prisma.user.update({
        where: { id: supplier.userId },
        data: { isActive: true },
      }),
    ]);

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_APPROVED',
      title: '供应商审核通过',
      content: `您的供应商注册申请已审核通过，企业名称：${supplier.name}`,
      link: `/supplier/${id}`,
    });

    return { success: true };
  }

  async reject(id: string, reason: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING' && supplier.status !== 'RETURNED') {
      throw new BadRequestException({ error: '供应商状态不允许审核', code: 'INVALID_STATUS' });
    }

    const result = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
    });

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_REJECTED',
      title: '供应商审核不通过',
      content: `您的供应商注册申请审核不通过，原因：${reason}`,
    });

    return result;
  }

  async return(id: string, reason: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'PENDING') {
      throw new BadRequestException({ error: '供应商状态不允许退回', code: 'INVALID_STATUS' });
    }

    const result = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'RETURNED', returnReason: reason },
    });

    // 发送通知给供应商
    await this.notificationService.create({
      userId: supplier.userId,
      type: 'SUPPLIER_RETURNED',
      title: '供应商注册退回补正',
      content: `您的供应商注册申请需补充修改，原因：${reason}`,
      link: `/supplier/register`,
    });

    return result;
  }

  async updateStatus(id: string, status: 'DISABLED' | 'BLACKLIST', reason: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可以调整状态', code: 'INVALID_STATUS' });
    }

    return this.prisma.supplier.update({
      where: { id },
      data: { status, returnReason: reason },
    });
  }

  async listChanges(supplierId: string) {
    return this.prisma.supplierChangeRecord.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createChangeRequest(supplierId: string, userId: string, dto: CreateChangeRequestDto) {
    // 验证供应商状态
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只有已入库供应商可以提交变更', code: 'INVALID_STATUS' });
    }

    // 验证所有权
    if (supplier.userId !== userId) {
      throw new ForbiddenException({ error: '只能提交自己的变更申请', code: 'FORBIDDEN' });
    }

    // 字段白名单校验
    if (!isSupplierChangeAllowedField(dto.fieldName)) {
      throw new BadRequestException({ error: '该字段不允许通过变更申请修改', code: 'FIELD_NOT_ALLOWED' });
    }

    // 获取旧值
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

  async approveChange(changeId: string, reviewerId: string) {
    const change = await this.prisma.supplierChangeRecord.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new BadRequestException({ error: '变更记录不存在', code: 'NOT_FOUND' });
    }
    if (change.status !== 'PENDING') {
      throw new BadRequestException({ error: '变更记录已处理', code: 'INVALID_STATUS' });
    }

    // 审批时再次校验白名单（不信任历史数据）
    if (!isSupplierChangeAllowedField(change.fieldName)) {
      throw new BadRequestException({ error: '该字段不允许通过变更申请修改', code: 'FIELD_NOT_ALLOWED' });
    }

    // 更新变更记录和供应商字段
    await this.prisma.$transaction([
      this.prisma.supplierChangeRecord.update({
        where: { id: changeId },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.supplier.update({
        where: { id: change.supplierId },
        data: { [change.fieldName]: change.newValue },
      }),
    ]);

    return { success: true };
  }

  async rejectChange(changeId: string, reviewerId: string, reason: string) {
    const change = await this.prisma.supplierChangeRecord.findUnique({
      where: { id: changeId },
    });
    if (!change) {
      throw new BadRequestException({ error: '变更记录不存在', code: 'NOT_FOUND' });
    }
    if (change.status !== 'PENDING') {
      throw new BadRequestException({ error: '变更记录已处理', code: 'INVALID_STATUS' });
    }

    return this.prisma.supplierChangeRecord.update({
      where: { id: changeId },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
  }

  async listQualifications(supplierId: string) {
    return this.prisma.supplierQualification.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addQualification(supplierId: string, dto: CreateQualificationDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }

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
      throw new BadRequestException({ error: '资质材料不存在或不属于此供应商', code: 'NOT_FOUND' });
    }

    return this.prisma.supplierQualification.delete({
      where: { id: qualificationId },
    });
  }

  async checkQualificationExpiry() {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 查找即将过期的资质
    const expiringQualifications = await this.prisma.supplierQualification.findMany({
      where: {
        validTo: { lte: thirtyDaysLater, gte: now },
        status: '有效',
      },
      include: { supplier: true },
    });

    // 更新状态为即将过期
    for (const q of expiringQualifications) {
      await this.prisma.supplierQualification.update({
        where: { id: q.id },
        data: { status: '即将过期' },
      });
    }

    // 查找已过期的资质
    const expiredQualifications = await this.prisma.supplierQualification.findMany({
      where: {
        validTo: { lt: now },
        status: { not: '已过期' },
      },
    });

    for (const q of expiredQualifications) {
      await this.prisma.supplierQualification.update({
        where: { id: q.id },
        data: { status: '已过期' },
      });
    }

    return { expiring: expiringQualifications.length, expired: expiredQualifications.length };
  }

  async listEvaluations(supplierId: string) {
    return this.prisma.supplierEvaluation.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
      include: {
        evaluator: { select: { id: true, displayName: true } },
      },
    });
  }

  async createEvaluation(supplierId: string, evaluatorId: string, dto: CreateEvaluationDto) {
    // 验证供应商状态
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BadRequestException({ error: '供应商不存在', code: 'NOT_FOUND' });
    }
    if (supplier.status !== 'APPROVED') {
      throw new BadRequestException({ error: '只能评价已入库供应商', code: 'INVALID_STATUS' });
    }

    // 计算总分
    const totalScore = dto.completenessScore + dto.responsivenessScore + dto.cooperationScore + dto.complianceScore + dto.overallScore;

    // 确定等级
    let level: string;
    if (totalScore >= 90) {
      level = 'A';
    } else if (totalScore >= 80) {
      level = 'B';
    } else if (totalScore >= 60) {
      level = 'C';
    } else {
      level = 'D';
    }

    return this.prisma.supplierEvaluation.create({
      data: {
        supplierId,
        projectId: dto.projectId,
        evaluatorId,
        score: totalScore,
        level,
        completenessScore: dto.completenessScore,
        responsivenessScore: dto.responsivenessScore,
        cooperationScore: dto.cooperationScore,
        complianceScore: dto.complianceScore,
        overallScore: dto.overallScore,
        comment: dto.comment,
      },
    });
  }

  async getEvaluationStats() {
    const evaluations = await this.prisma.supplierEvaluation.findMany({
      select: { level: true, score: true },
    });

    const levelCounts = {
      A: evaluations.filter(e => e.level === 'A').length,
      B: evaluations.filter(e => e.level === 'B').length,
      C: evaluations.filter(e => e.level === 'C').length,
      D: evaluations.filter(e => e.level === 'D').length,
    };

    const avgScore = evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + Number(e.score), 0) / evaluations.length
      : 0;

    return { levelCounts, avgScore, total: evaluations.length };
  }

  async getStats() {
    const [total, pending, approved, disabled, blacklist] = await Promise.all([
      this.prisma.supplier.count(),
      this.prisma.supplier.count({ where: { status: 'PENDING' } }),
      this.prisma.supplier.count({ where: { status: 'APPROVED' } }),
      this.prisma.supplier.count({ where: { status: 'DISABLED' } }),
      this.prisma.supplier.count({ where: { status: 'BLACKLIST' } }),
    ]);

    return { total, pending, approved, disabled, blacklist };
  }

  async listClassifications() {
    return this.prisma.supplierClassification.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { suppliers: true } },
      },
    });
  }

  async createClassification(dto: CreateClassificationDto) {
    // 检查名称和代码是否重复
    const existingName = await this.prisma.supplierClassification.findUnique({
      where: { name: dto.name },
    });
    if (existingName) {
      throw new BadRequestException({ error: '分类名称已存在', code: 'DUPLICATE_NAME' });
    }

    const existingCode = await this.prisma.supplierClassification.findUnique({
      where: { code: dto.code },
    });
    if (existingCode) {
      throw new BadRequestException({ error: '分类代码已存在', code: 'DUPLICATE_CODE' });
    }

    return this.prisma.supplierClassification.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
      },
    });
  }

  async updateClassification(id: string, dto: UpdateClassificationDto) {
    return this.prisma.supplierClassification.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
      },
    });
  }

  async deleteClassification(id: string) {
    // 检查是否有供应商使用此分类
    const suppliersCount = await this.prisma.supplier.count({
      where: { classificationId: id },
    });
    if (suppliersCount > 0) {
      throw new BadRequestException({ error: '此分类下有供应商，无法删除', code: 'HAS_SUPPLIERS' });
    }

    return this.prisma.supplierClassification.delete({
      where: { id },
    });
  }
}