import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReviewSubmissionDto } from '../project-management/dto/review-submission.dto';
import { CreatePlanItemDto } from './dto/create-plan-item.dto';
import { UpdatePlanItemDto } from './dto/update-plan-item.dto';
import { CreateTeamMemberDto, UpdateTeamMemberDto } from './dto/team-member.dto';

const REVIEWERS = ['leader', 'admin'];

/** CTS-EBS01 A-47~49 任务计划（整包报审，双人留痕同 A-36/37 模式）与项目团队 */
@Injectable()
export class ProjectPlanService {
  constructor(private readonly prisma: PrismaService) {}

  private async userNameMap(ids: Array<string | null | undefined>) {
    const uniq = [...new Set(ids.filter((v): v is string => !!v))];
    if (!uniq.length) return {} as Record<string, string>;
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniq } },
      select: { id: true, displayName: true, username: true },
    });
    return Object.fromEntries(users.map((u) => [u.id, u.displayName || u.username]));
  }

  // ── A-47 任务计划条目 ──

  async listPlans(projectId: string) {
    const rows = await this.prisma.projectPlanItem.findMany({
      where: { projectManagementItemId: projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const names = await this.userNameMap(rows.flatMap((r) => [r.ownerUserId, r.submittedById, r.reviewedById]));
    return rows.map((r) => ({
      ...r,
      ownerName: r.ownerUserId ? names[r.ownerUserId] ?? null : null,
      submittedByName: r.submittedById ? names[r.submittedById] ?? null : null,
      reviewedByName: r.reviewedById ? names[r.reviewedById] ?? null : null,
    }));
  }

  async createPlan(projectId: string, dto: CreatePlanItemDto) {
    return this.prisma.projectPlanItem.create({
      data: {
        projectManagementItemId: projectId,
        content: dto.content,
        ownerUserId: dto.ownerUserId ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updatePlan(projectId: string, planId: string, dto: UpdatePlanItemDto) {
    const prevStatus = await this.assertEditable(projectId, planId);
    return this.prisma.projectPlanItem.update({
      where: { id: planId },
      data: {
        // A-07/A-49：已通过的条目允许调整，调整即降回草稿重新报审（避免通过后永久锁死的死锁）
        ...(prevStatus === 'APPROVED' && { status: 'DRAFT', reviewedAt: null, reviewedById: null, reviewComment: null }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.ownerUserId !== undefined && { ownerUserId: dto.ownerUserId }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deletePlan(projectId: string, planId: string) {
    await this.assertEditable(projectId, planId);
    await this.prisma.projectPlanItem.delete({ where: { id: planId } });
    return { ok: true };
  }

  /** 报审中（SUBMITTED）锁定不可改删；其余状态放行并返回原状态供调用方决定是否降级 */
  private async assertEditable(projectId: string, planId: string): Promise<'DRAFT' | 'REJECTED' | 'APPROVED'> {
    const row = await this.prisma.projectPlanItem.findFirst({
      where: { id: planId, projectManagementItemId: projectId },
      select: { status: true },
    });
    if (!row) throw new NotFoundException('未找到对应计划条目。');
    if (row.status === 'SUBMITTED') {
      throw new BadRequestException({ error: '该条目已报审待审核，不可修改', code: 'PLAN_LOCKED' });
    }
    return row.status as 'DRAFT' | 'REJECTED' | 'APPROVED';
  }

  // ── A-49 整包报审/受理 ──

  /** DRAFT/REJECTED 条目整包 → SUBMITTED */
  async submitPlans(projectId: string, user?: AuthenticatedUser) {
    const res = await this.prisma.projectPlanItem.updateMany({
      where: { projectManagementItemId: projectId, status: { in: ['DRAFT', 'REJECTED'] } },
      data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: user?.sub ?? null, reviewComment: null },
    });
    if (res.count === 0) {
      throw new BadRequestException({ error: '没有可报审的计划条目（新增或被驳回的条目才可报审）', code: 'NOTHING_TO_SUBMIT' });
    }
    return { submitted: res.count };
  }

  /** SUBMITTED 条目整包受理：通过/驳回（leader/admin；非 admin 不得自审；驳回须理由） */
  async reviewPlans(projectId: string, dto: ReviewSubmissionDto, user?: AuthenticatedUser) {
    if (!user || !REVIEWERS.includes(user.role)) {
      throw new ForbiddenException({ error: '仅领导或管理员可受理审核', code: 'REVIEW_ROLE_FORBIDDEN' });
    }
    const pending = await this.prisma.projectPlanItem.findMany({
      where: { projectManagementItemId: projectId, status: 'SUBMITTED' },
      select: { submittedById: true },
    });
    if (!pending.length) {
      throw new BadRequestException({ error: '没有待审核的计划条目', code: 'NOT_PENDING_REVIEW' });
    }
    if (user.role !== 'admin' && pending.some((r) => r.submittedById === user.sub)) {
      throw new BadRequestException({ error: '报审人与审核人不得为同一人，请由领导或管理员受理', code: 'SELF_REVIEW_FORBIDDEN' });
    }
    if (!dto.approve && !dto.comment?.trim()) {
      throw new BadRequestException({ error: '驳回必须填写理由', code: 'REJECT_REASON_REQUIRED' });
    }
    const res = await this.prisma.projectPlanItem.updateMany({
      where: { projectManagementItemId: projectId, status: 'SUBMITTED' },
      data: {
        status: dto.approve ? 'APPROVED' : 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: user.sub,
        reviewComment: dto.comment?.trim() || null,
      },
    });
    return { reviewed: res.count, approved: dto.approve };
  }

  // ── A-48 项目团队 ──

  /** 团队/责任人候选用户（内部管理角色；宿主选择器数据源） */
  async listCandidateUsers() {
    return this.prisma.user.findMany({
      where: { role: { in: ['leader', 'staff', 'admin'] }, isActive: true },
      select: { id: true, username: true, displayName: true },
      orderBy: { username: 'asc' },
      take: 200,
    });
  }

  async listTeam(projectId: string) {
    const rows = await this.prisma.projectTeamMember.findMany({
      where: { projectManagementItemId: projectId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, username: true, displayName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      role: r.role,
      duty: r.duty,
      memberName: r.user?.displayName || r.user?.username,
    }));
  }

  async addTeamMember(projectId: string, dto: CreateTeamMemberDto) {
    const exists = await this.prisma.projectTeamMember.findFirst({
      where: { projectManagementItemId: projectId, userId: dto.userId },
      select: { id: true },
    });
    if (exists) throw new BadRequestException({ error: '该成员已在团队中', code: 'DUPLICATE_MEMBER' });
    return this.prisma.projectTeamMember.create({
      data: { projectManagementItemId: projectId, userId: dto.userId, role: dto.role, duty: dto.duty ?? null },
    });
  }

  async updateTeamMember(projectId: string, memberId: string, dto: UpdateTeamMemberDto) {
    const row = await this.prisma.projectTeamMember.findFirst({
      where: { id: memberId, projectManagementItemId: projectId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('未找到对应团队成员。');
    return this.prisma.projectTeamMember.update({
      where: { id: memberId },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.duty !== undefined && { duty: dto.duty }),
      },
    });
  }

  async removeTeamMember(projectId: string, memberId: string) {
    const row = await this.prisma.projectTeamMember.findFirst({
      where: { id: memberId, projectManagementItemId: projectId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('未找到对应团队成员。');
    await this.prisma.projectTeamMember.delete({ where: { id: memberId } });
    return { ok: true };
  }
}
