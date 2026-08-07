import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ResultStatus, SourceType } from '@prisma/client';
import { CreateProcurementRoundDto } from './dto/create-procurement-round.dto';
import { UpdateProcurementRoundDto } from './dto/update-procurement-round.dto';
import { QueryProcurementsDto } from './dto/query-procurements.dto';
import { canViewGlobalBusinessData } from '../auth/auth-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createHash } from 'node:crypto';

@Injectable()
export class ProcurementsService {
  private readonly logger = new Logger(ProcurementsService.name);

  /** ERP Supplier 模型需要 user/enterpriseType 等必填字段 */
  private async makeSupplier(name: string) {
    const nn = this.normalizeName(name);
    const uid = createHash('sha256').update(`supplier_${nn}`).digest('hex').slice(0, 24);
    const [row] = await this.prisma.$queryRaw<Array<{ supplier_no: string }>>`
      SELECT 'SUP-' || lpad(nextval('supplier_no_seq')::text, 6, '0') AS supplier_no
    `;
    return {
      name,
      normalizedName: nn,
      supplierNo: row.supplier_no,
      enterpriseType: '有限责任公司',
      legalPerson: name,
      registeredAddress: '（待补充）',
      businessScope: '（待补充）',
      user: {
        create: {
          username: `supplier_auto_${uid}`,
          displayName: name,
          role: 'supplier',
        },
      },
    };
  }

  constructor(private readonly prisma: PrismaService) {}

  private checkOwnership(round: { createdById: string | null }, user: AuthenticatedUser) {
    if (!canViewGlobalBusinessData(user.role) && round.createdById !== user.sub) {
      throw new ForbiddenException('无权操作此采购记录。');
    }
  }

  async findAll(query: QueryProcurementsDto, user: AuthenticatedUser) {
    const {
      page,
      pageSize,
      startDate,
      endDate,
      procurementMethod,
      departmentId,
      resultStatus,
      searchKeyword,
      sortBy,
      sortOrder,
      recycleStatus,
    } = query;

    const where: any = {};

    if (recycleStatus === 'RECYCLED') {
      where.isRecycled = true;
    } else if (recycleStatus !== 'ALL') {
      where.isRecycled = false;
    }

    if (startDate || endDate) {
      where.procurementDate = {};
      if (startDate) where.procurementDate.gte = new Date(startDate);
      if (endDate) where.procurementDate.lte = new Date(endDate);
    }

    if (procurementMethod) {
      where.procurementMethod = procurementMethod;
    }

    if (departmentId) {
      where.departmentId = departmentId;
    }

    if (resultStatus) {
      where.resultStatus = resultStatus;
    }

    if (!canViewGlobalBusinessData(user.role)) {
      where.createdById = user.sub;
    }

    if (searchKeyword) {
      where.OR = [
        { project: { name: { contains: searchKeyword, mode: 'insensitive' } } },
        {
          awardedSupplier: {
            name: { contains: searchKeyword, mode: 'insensitive' },
          },
        },
        { supplierText: { contains: searchKeyword, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = {};
    orderBy[sortBy ?? 'procurementDate'] = sortOrder ?? 'desc';

    const [total, data] = await Promise.all([
      this.prisma.procurementRound.count({ where }),
      this.prisma.procurementRound.findMany({
        where,
        orderBy,
        skip: (page! - 1) * pageSize!,
        take: pageSize!,
        include: {
          project: true,
          department: true,
          awardedSupplier: true,
          createdBy: true,
          participants: {
            include: { supplier: true },
            orderBy: { sequenceNo: 'asc' },
          },
        },
      }),
    ]);

    // For PROJECT_MANAGEMENT source type, find the original project management item
    const projectManagementRounds = data.filter(
      (round) => round.sourceType === SourceType.PROJECT_MANAGEMENT,
    );

    const pmInfoMap: Record<string, any> = {};
    if (projectManagementRounds.length > 0) {
      const roundIds = projectManagementRounds.map((r) => r.id);
      const pmItems = await this.prisma.projectManagementItem.findMany({
        where: {
          archivedProcurementRoundId: { in: roundIds },
        },
        select: {
          id: true,
          archivedProcurementRoundId: true,
          initiationDate: true,
          evaluationMethod: true,
          biddingUnits: true,
          awardedSupplier: true,
          contractAmount: true,
          contractNumber: true,
          demandContractNumber: true,
          archivedAt: true,
          procurementOrganizationForm: true,
        },
      });
      for (const item of pmItems) {
        if (item.archivedProcurementRoundId) {
          pmInfoMap[item.archivedProcurementRoundId] = item;
        }
      }
    }

    return {
      data: data.map((round) =>
        this.formatRound(round, pmInfoMap[round.id]),
      ),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize!),
      },
    };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const round = await this.prisma.procurementRound.findUnique({
      where: { id },
      include: {
        project: true,
        department: true,
        awardedSupplier: true,
        participants: {
          include: { supplier: true },
          orderBy: { sequenceNo: 'asc' },
        },
      },
    });

    if (!round) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(round, user);

    return this.formatRound(round);
  }

  async create(dto: CreateProcurementRoundDto, userId?: string) {
    // Handle department
    let departmentId: string | null = null;
    if (dto.departmentId) {
      departmentId = dto.departmentId;
    } else if (dto.departmentName) {
      const dept = await this.prisma.department.upsert({
        where: { name: dto.departmentName },
        update: {},
        create: { name: dto.departmentName },
      });
      departmentId = dept.id;
    }

    // Handle project
    const projectCode =
      dto.projectCode || this.generateProjectCode(dto.projectName);
    const project = await this.prisma.project.upsert({
      where: { projectCode },
      update: {
        name: dto.projectName,
        requestingDepartmentId: departmentId,
      },
      create: {
        projectCode,
        name: dto.projectName,
        requestingDepartmentId: departmentId,
      },
    });

    // Handle awarded supplier
    let awardedSupplierId: string | null = null;
    if (dto.awardedSupplierId) {
      awardedSupplierId = dto.awardedSupplierId;
    } else if (dto.awardedSupplierName) {
      const supplier = await this.prisma.supplier.upsert({
        where: { normalizedName: this.normalizeName(dto.awardedSupplierName) },
        update: { name: dto.awardedSupplierName },
        create: await this.makeSupplier(dto.awardedSupplierName),
      });
      awardedSupplierId = supplier.id;
    }

    // Get next round number for this project, with retry on concurrent race
    let round: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      const roundNo = await this.getNextRoundNo(project.id);
      try {
        round = await this.prisma.procurementRound.create({
          data: {
            projectId: project.id,
            roundNo,
            procurementDate: dto.procurementDate
              ? new Date(dto.procurementDate)
              : null,
            procurementMethod: dto.procurementMethod,
            departmentId,
            budgetAmount: dto.budgetAmount,
            controlAmount: dto.controlAmount,
            awardedSupplierId,
            awardAmount: dto.awardAmount,
            resultStatus: dto.resultStatus || ResultStatus.PENDING,
            resultText: dto.resultText,
            sourceType: SourceType.MANUAL,
            createdById: userId,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 2) {
          this.logger.warn(
            `RoundNo race for project ${project.id}, retrying (attempt ${attempt + 1})`,
          );
          continue;
        }
        throw err;
      }
    }
    if (!round) {
      throw new ConflictException('创建采购轮次失败，请重试。');
    }

    // Handle participants
    const supplierIds = dto.supplierIds || [];
    const supplierNames = dto.supplierNames || [];

    for (let i = 0; i < supplierIds.length; i++) {
      await this.prisma.roundParticipant.create({
        data: {
          procurementRoundId: round.id,
          supplierId: supplierIds[i],
          sequenceNo: i + 1,
        },
      });
    }

    for (const [i, name] of supplierNames.entries()) {
      if (!supplierIds[i]) {
        const supplier = await this.prisma.supplier.upsert({
          where: { normalizedName: this.normalizeName(name) },
          update: { name },
          create: await this.makeSupplier(name),
        });
        await this.prisma.roundParticipant.create({
          data: {
            procurementRoundId: round.id,
            supplierId: supplier.id,
            sequenceNo: supplierIds.length + i + 1,
          },
        });
      }
    }

    return this.findOne(round.id, { sub: userId!, username: '', role: 'admin' } as AuthenticatedUser);
  }

  async update(id: string, dto: UpdateProcurementRoundDto, user: AuthenticatedUser) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user);

    // Handle department update
    let departmentId: string | null = existing.departmentId;
    if (dto.departmentId) {
      departmentId = dto.departmentId;
    } else if (dto.departmentName) {
      const dept = await this.prisma.department.upsert({
        where: { name: dto.departmentName },
        update: {},
        create: { name: dto.departmentName },
      });
      departmentId = dept.id;
    }

    // Handle awarded supplier update
    let awardedSupplierId: string | null = existing.awardedSupplierId;
    if (dto.awardedSupplierId) {
      awardedSupplierId = dto.awardedSupplierId;
    } else if (dto.awardedSupplierName) {
      const supplier = await this.prisma.supplier.upsert({
        where: { normalizedName: this.normalizeName(dto.awardedSupplierName) },
        update: { name: dto.awardedSupplierName },
        create: await this.makeSupplier(dto.awardedSupplierName),
      });
      awardedSupplierId = supplier.id;
    }

    const result = await this.prisma.procurementRound.updateMany({
      where: {
        id,
        updatedAt: existing.updatedAt,
      },
      data: {
        procurementDate: dto.procurementDate
          ? new Date(dto.procurementDate)
          : existing.procurementDate,
        procurementMethod: dto.procurementMethod || existing.procurementMethod,
        departmentId,
        budgetAmount: dto.budgetAmount ?? existing.budgetAmount,
        controlAmount: dto.controlAmount ?? existing.controlAmount,
        awardedSupplierId,
        awardAmount: dto.awardAmount ?? existing.awardAmount,
        resultStatus: dto.resultStatus || existing.resultStatus,
        resultText: dto.resultText || existing.resultText,
        updatedById: user.sub,
      },
    });

    if (result.count === 0) {
      throw new ConflictException('数据已被他人修改，请刷新后重试。');
    }

    return this.findOne(id, user);
  }

  async moveToRecycleBin(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user);

    return this.prisma.procurementRound.update({
      where: { id },
      data: { isRecycled: true },
    });
  }

  async restoreFromRecycleBin(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user);

    return this.prisma.procurementRound.update({
      where: { id },
      data: { isRecycled: false },
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.procurementRound.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Procurement round ${id} not found`);
    }

    this.checkOwnership(existing, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.roundParticipant.deleteMany({
        where: { procurementRoundId: id },
      });
      await tx.procurementRound.delete({
        where: { id },
      });
    });

    return { deleted: true, id };
  }

  async getStats(startDate?: string, endDate?: string, user?: AuthenticatedUser) {
    const where: any = {};

    if (startDate || endDate) {
      where.procurementDate = {};
      if (startDate) where.procurementDate.gte = new Date(startDate);
      if (endDate) where.procurementDate.lte = new Date(endDate);
    }

    if (user && !canViewGlobalBusinessData(user.role)) {
      where.createdById = user.sub;
    }

    const [
      totalCount,
      awardedCount,
      pendingCount,
      abnormalCount,
      budgetSum,
      awardSum,
    ] = await Promise.all([
      this.prisma.procurementRound.count({ where }),
      this.prisma.procurementRound.count({
        where: { ...where, resultStatus: ResultStatus.AWARDED },
      }),
      this.prisma.procurementRound.count({
        where: { ...where, resultStatus: ResultStatus.PENDING },
      }),
      this.prisma.procurementRound.count({
        where: {
          ...where,
          resultStatus: {
            in: [
              ResultStatus.FAILED_REVIEW,
              ResultStatus.FILE_REVISION_REQUIRED,
              ResultStatus.INVALID_RESPONSE,
              ResultStatus.CANCELLED,
            ],
          },
        },
      }),
      this.prisma.procurementRound.aggregate({
        where: { ...where, budgetAmount: { not: null } },
        _sum: { budgetAmount: true },
      }),
      this.prisma.procurementRound.aggregate({
        where: { ...where, awardAmount: { not: null } },
        _sum: { awardAmount: true },
      }),
    ]);

    const totalBudget = Number(budgetSum._sum.budgetAmount || 0);
    const totalAward = Number(awardSum._sum.awardAmount || 0);
    const totalSavings = totalBudget - totalAward;

    return {
      totalCount,
      awardedCount,
      pendingCount,
      abnormalCount,
      totalBudget,
      totalBudgetLabel: this.formatWan(totalBudget),
      totalAward,
      totalAwardLabel: this.formatWan(totalAward),
      totalSavings: totalSavings > 0 ? totalSavings : 0,
      totalSavingsLabel: totalSavings > 0 ? this.formatWan(totalSavings) : '0',
    };
  }

  async getProcurementMethods() {
    const methods = await this.prisma.procurementRound.findMany({
      select: { procurementMethod: true },
      distinct: ['procurementMethod'],
    });
    return methods.map((m) => m.procurementMethod).filter(Boolean);
  }

  private formatRound(round: any, pmInfo?: any) {
    return {
      id: round.id,
      projectId: round.projectId,
      projectName: round.project?.name || '',
      projectCode: round.project?.projectCode || '',
      roundNo: round.roundNo,
      procurementDate:
        round.procurementDate?.toISOString().split('T')[0] || null,
      procurementMethod: round.procurementMethod,
      departmentId: round.departmentId,
      departmentName: round.department?.name || '',
      supplierNames:
        round.participants?.map((p: any) => p.supplier?.name).filter(Boolean) ||
        [],
      budgetAmount: round.budgetAmount,
      controlAmount: round.controlAmount,
      awardedSupplierId: round.awardedSupplierId,
      awardedSupplierName: round.awardedSupplier?.name || null,
      awardAmount: round.awardAmount,
      resultStatus: round.resultStatus,
      resultStatusLabel: this.getResultStatusLabel(round.resultStatus),
      resultText: round.resultText,
      sourceType: round.sourceType || 'MANUAL',
      projectManagementId: pmInfo?.id || null,
      createdById: round.createdById || null,
      createdByName: round.createdBy?.displayName || null,
      createdAt: round.createdAt.toISOString(),
      updatedAt: round.updatedAt.toISOString(),
      isRecycled: Boolean(round.isRecycled),
      // Project management extracted info
      initiationDate: pmInfo?.initiationDate?.toISOString().split('T')[0] || null,
      evaluationMethod: pmInfo?.evaluationMethod || null,
      biddingUnits: pmInfo?.biddingUnits || null,
      pmAwardedSupplier: pmInfo?.awardedSupplier || null,
      contractAmount: pmInfo?.contractAmount || null,
      contractNumber: pmInfo?.contractNumber || pmInfo?.demandContractNumber || null,
      archivedAt: pmInfo?.archivedAt?.toISOString().split('T')[0] || null,
      procurementOrganizationForm: pmInfo?.procurementOrganizationForm || null,
    };
  }

  private getResultStatusLabel(status: ResultStatus): string {
    const labels: Record<ResultStatus, string> = {
      AWARDED: '已成交',
      FAILED_REVIEW: '资格审查未通过',
      FILE_REVISION_REQUIRED: '采购文件需修改',
      INVALID_RESPONSE: '未按要求响应',
      PENDING: '待处理',
      CANCELLED: '已取消',
    };
    return labels[status] || status;
  }

  private formatWan(value: number): string {
    if (value >= 10000) {
      return `${(value / 10000).toFixed(2)}万`;
    }
    return `${value.toFixed(2)}元`;
  }

  private generateProjectCode(name: string): string {
    return `MANUAL-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`;
  }

  /**
   * Get the next round number for a project.
   * Uses findFirst + orderBy (instead of count) so deleted rounds don't cause collisions.
   * The caller MUST retry on P2002 to handle concurrent inserts on the same project.
   */
  private async getNextRoundNo(projectId: string): Promise<number> {
    const max = await this.prisma.procurementRound.findFirst({
      where: { projectId },
      orderBy: { roundNo: 'desc' },
      select: { roundNo: true },
    });
    return (max?.roundNo ?? 0) + 1;
  }

  private normalizeName(name: string): string {
    return name.replace(/\s+/g, '').trim();
  }
}
