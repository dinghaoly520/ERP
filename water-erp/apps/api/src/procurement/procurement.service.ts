import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProcurementDto, UpdateProcurementDto } from './dto/create-procurement.dto';

type ProcurementStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'BIDDING' | 'CONTRACTED' | 'CLOSED';

const STATUS_TRANSITIONS: Record<ProcurementStatus, ProcurementStatus[]> = {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED: ['BIDDING'],
  REJECTED: ['DRAFT'],
  BIDDING: ['CONTRACTED'],
  CONTRACTED: ['CLOSED'],
  CLOSED: [],
};

@Injectable()
export class ProcurementService {
  constructor(private prisma: PrismaService) {}

  async list(status?: string) {
    return this.prisma.procurementProject.findMany({
      where: status ? { status: status as ProcurementStatus } : undefined,
      include: {
        department: { select: { id: true, name: true } },
        creator: { select: { id: true, displayName: true } },
        bidProject: { select: { id: true, projectCode: true, name: true, stage: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStats() {
    const counts = await this.prisma.procurementProject.groupBy({
      by: ['status'],
      _count: { status: true },
    });
    const distribution: Record<string, number> = {};
    counts.forEach(c => { distribution[c.status] = c._count.status; });

    const total = await this.prisma.procurementProject.count();

    return { total, ...distribution };
  }

  async get(id: string) {
    const project = await this.prisma.procurementProject.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        creator: { select: { id: true, displayName: true } },
        bidProject: { select: { id: true, projectCode: true, name: true, stage: true } },
      },
    });
    if (!project) throw new NotFoundException('采购项目不存在');
    return project;
  }

  async create(dto: CreateProcurementDto, creatorId?: string) {
    return this.prisma.procurementProject.create({
      data: {
        title: dto.title,
        projectCode: `PROC-${Date.now()}`,
        procurementType: dto.procurementType,
        procurementMethod: dto.procurementMethod,
        budget: dto.budget,
        description: dto.description,
        departmentId: dto.departmentId,
        creatorId,
      },
    });
  }

  async update(id: string, dto: UpdateProcurementDto) {
    const project = await this.prisma.procurementProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('采购项目不存在');
    if (project.status !== 'DRAFT') {
      throw new BadRequestException({ error: '只能编辑草稿状态的项目', code: 'NOT_DRAFT' });
    }

    return this.prisma.procurementProject.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.procurementType && { procurementType: dto.procurementType }),
        ...(dto.procurementMethod && { procurementMethod: dto.procurementMethod }),
        ...(dto.budget !== undefined && { budget: dto.budget }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  private assertStatusTransition(from: ProcurementStatus, to: ProcurementStatus) {
    const allowed = STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictException(`非法采购状态流转：${from} -> ${to}`);
    }
  }

  async submit(id: string) {
    const project = await this.prisma.procurementProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('采购项目不存在');
    this.assertStatusTransition(project.status as ProcurementStatus, 'PENDING_REVIEW');

    return this.prisma.procurementProject.update({
      where: { id },
      data: { status: 'PENDING_REVIEW' },
    });
  }

  async approve(id: string) {
    const project = await this.prisma.procurementProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('采购项目不存在');
    this.assertStatusTransition(project.status as ProcurementStatus, 'APPROVED');

    return this.prisma.procurementProject.update({
      where: { id },
      data: { status: 'APPROVED', rejectReason: null },
    });
  }

  async reject(id: string, reason: string) {
    const project = await this.prisma.procurementProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('采购项目不存在');
    this.assertStatusTransition(project.status as ProcurementStatus, 'REJECTED');

    return this.prisma.procurementProject.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason: reason },
    });
  }

  async createBid(id: string, dto?: { openTime?: string; deadline?: string }) {
    const project = await this.prisma.procurementProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('采购项目不存在');
    this.assertStatusTransition(project.status as ProcurementStatus, 'BIDDING');

    // G8: 参数化时间；默认 截标 5 天后 / 开标 7 天后（截标必须早于开标）
    const openTime = dto?.openTime ? new Date(dto.openTime) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const deadline = dto?.deadline ? new Date(dto.deadline) : new Date(Date.now() + 5 * 24 * 3600 * 1000);
    if (!(deadline.getTime() < openTime.getTime())) {
      throw new BadRequestException({
        error: '投标截止时间必须早于开标时间',
        code: 'INVALID_BID_TIME',
      });
    }

    const bidProject = await this.prisma.bidProject.create({
      data: {
        name: project.title,
        projectCode: `BID-${Date.now()}`,
        procurementMethod: project.procurementMethod,
        openTime,
        deadline,
      },
    });

    await this.prisma.procurementProject.update({
      where: { id },
      data: { status: 'BIDDING', bidProjectId: bidProject.id },
    });

    return { procurement: await this.get(id), bidProject };
  }
}
