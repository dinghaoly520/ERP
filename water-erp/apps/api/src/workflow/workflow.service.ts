import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * C1 统一流程中心（CTS-EBS01 收窄版路线图）：五源审批的**只读聚合**。
 * 各审批源实现保持原样（延续账号管理「三合一」先例），本服务只做统一出参与排序。
 *
 * 源清单（deepLink 指向既有处理页）：
 * - supplier_registration 供应商注册审核（admin）      → /admin/accounts
 * - password_change     修改密码申请（admin）           → /admin/accounts
 * - password_reset      忘记密码重置（admin）           → /admin/accounts
 * - profile_change      资料变更申请（admin）           → /admin/accounts
 * - supplier_change     供应商资料变更（staff/leader/admin）→ /supplier/approval
 * - catalog_application 目录供货申请（staff/leader/admin） → /mall-management
 */

export type WorkflowSource =
  | 'supplier_registration'
  | 'password_change'
  | 'password_reset'
  | 'profile_change'
  | 'supplier_change'
  | 'catalog_application';

export interface WorkflowItem {
  source: WorkflowSource;
  sourceId: string;
  category: string;
  title: string;
  applicant: string | null;
  submittedAt: Date;
  /** 处理页路由（:3005 站内绝对路径） */
  deepLink: string;
  status: string;
}

const byTimeDesc = (a: WorkflowItem, b: WorkflowItem) =>
  (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0);

const PROFILE_FIELD_LABELS: Record<string, string> = {
  displayName: '姓名', email: '邮箱', phone: '手机号', officeLocation: '办公地点',
  company: '公司', departmentId: '部门', avatar: '头像',
};

@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  /** 待我审批：admin 专属四源 + 通用两源，submittedAt 倒序。 */
  async pending(role: string): Promise<WorkflowItem[]> {
    const items: WorkflowItem[] = [];

    if (role === 'admin') {
      const [regs, pwChanges, pwResets, profileChanges] = await Promise.all([
        this.prisma.supplier.findMany({
          where: { status: 'PENDING' },
          select: { id: true, name: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: 50,
        }),
        this.prisma.passwordChangeRequest.findMany({
          where: { status: 'PENDING' },
          include: { user: { select: { displayName: true } } },
          orderBy: { requestedAt: 'desc' }, take: 50,
        }),
        this.prisma.passwordResetRequest.findMany({
          where: { status: 'PENDING' },
          orderBy: { requestedAt: 'desc' }, take: 50,
        }),
        this.prisma.profileChangeRequest.findMany({
          where: { status: 'PENDING' },
          include: { user: { select: { displayName: true } } },
          orderBy: { requestedAt: 'desc' }, take: 50,
        }),
      ]);

      for (const s of regs) {
        items.push({
          source: 'supplier_registration', sourceId: s.id, category: '注册审核',
          title: `供应商注册：${s.name}`, applicant: s.name,
          submittedAt: s.createdAt, deepLink: '/admin/accounts', status: 'PENDING',
        });
      }
      for (const r of pwChanges) {
        items.push({
          source: 'password_change', sourceId: r.id, category: '安全审批',
          title: '修改密码申请', applicant: r.user?.displayName ?? null,
          submittedAt: r.requestedAt, deepLink: '/admin/accounts', status: 'PENDING',
        });
      }
      for (const r of pwResets) {
        items.push({
          source: 'password_reset', sourceId: r.id, category: '安全审批',
          title: `忘记密码重置：${r.requestedUsername}`, applicant: r.applicantName ?? null,
          submittedAt: r.requestedAt, deepLink: '/admin/accounts', status: 'PENDING',
        });
      }
      for (const r of profileChanges) {
        const fields = Object.keys((r.payload as Record<string, unknown>) ?? {})
          .map(k => PROFILE_FIELD_LABELS[k] ?? k).join('、');
        items.push({
          source: 'profile_change', sourceId: r.id, category: '安全审批',
          title: `资料变更（${fields || '资料'}）`, applicant: r.user?.displayName ?? null,
          submittedAt: r.requestedAt, deepLink: '/admin/accounts', status: 'PENDING',
        });
      }
    }

    const [supChanges, catalogApps] = await Promise.all([
      this.prisma.supplierChangeRecord.findMany({
        where: { status: 'PENDING' },
        include: { supplier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, take: 50,
      }),
      this.prisma.supplierCatalogApplication.findMany({
        where: { status: 'PENDING' },
        include: { supplier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, take: 50,
      }),
    ]);

    for (const r of supChanges) {
      items.push({
        source: 'supplier_change', sourceId: r.id, category: '供应商变更',
        title: `${r.supplier?.name ?? '供应商'}申请变更「${r.fieldLabel ?? r.fieldName}」`,
        applicant: r.supplier?.name ?? null,
        submittedAt: r.createdAt, deepLink: '/supplier/approval', status: 'PENDING',
      });
    }
    for (const r of catalogApps) {
      const typeLabel = r.type === 'NEW_ITEM' ? '新增品类' : r.type === 'JOIN_EXISTING' ? '加入供货' : '调整报价';
      items.push({
        source: 'catalog_application', sourceId: r.id, category: '商城审批',
        title: `目录申请（${typeLabel}）：${r.supplier?.name ?? '供应商'}`,
        applicant: r.supplier?.name ?? null,
        submittedAt: r.createdAt, deepLink: '/mall-management', status: 'PENDING',
      });
    }

    return items.sort(byTimeDesc);
  }

  /** 我发起的：本人提交的密码/资料变更申请（含在途与已办）。 */
  async mine(userId: string): Promise<WorkflowItem[]> {
    const [pwChanges, profileChanges] = await Promise.all([
      this.prisma.passwordChangeRequest.findMany({
        where: { userId },
        include: { user: { select: { displayName: true } } },
        orderBy: { requestedAt: 'desc' }, take: 20,
      }),
      this.prisma.profileChangeRequest.findMany({
        where: { userId },
        include: { user: { select: { displayName: true } } },
        orderBy: { requestedAt: 'desc' }, take: 20,
      }),
    ]);
    const items: WorkflowItem[] = [];
    for (const r of pwChanges) {
      items.push({
        source: 'password_change', sourceId: r.id, category: '修改密码',
        title: '修改密码申请', applicant: r.user?.displayName ?? null,
        submittedAt: r.requestedAt, deepLink: '/profile', status: r.status,
      });
    }
    for (const r of profileChanges) {
      items.push({
        source: 'profile_change', sourceId: r.id, category: '资料变更',
        title: '资料变更申请', applicant: r.user?.displayName ?? null,
        submittedAt: r.requestedAt, deepLink: '/profile', status: r.status,
      });
    }
    return items.sort(byTimeDesc);
  }

  /** 最近已办：各源已处理记录按处理时间倒序（默认 20 条）。 */
  async done(limit = 20): Promise<WorkflowItem[]> {
    const [regReviews, pwChanges, pwResets, profileChanges, supChanges, catalogApps] = await Promise.all([
      this.prisma.registrationReview.findMany({ orderBy: { reviewedAt: 'desc' }, take: limit }),
      this.prisma.passwordChangeRequest.findMany({
        where: { status: { not: 'PENDING' } },
        include: { user: { select: { displayName: true } } },
        orderBy: { reviewedAt: 'desc' }, take: limit,
      }),
      this.prisma.passwordResetRequest.findMany({
        where: { status: { not: 'PENDING' } },
        orderBy: { reviewedAt: 'desc' }, take: limit,
      }),
      this.prisma.profileChangeRequest.findMany({
        where: { status: { not: 'PENDING' } },
        include: { user: { select: { displayName: true } } },
        orderBy: { reviewedAt: 'desc' }, take: limit,
      }),
      this.prisma.supplierChangeRecord.findMany({
        where: { status: { not: 'PENDING' } },
        include: { supplier: { select: { name: true } } },
        orderBy: { reviewedAt: 'desc' }, take: limit,
      }),
      this.prisma.supplierCatalogApplication.findMany({
        where: { status: { not: 'PENDING' } },
        include: { supplier: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' }, take: limit,
      }),
    ]);

    const items: WorkflowItem[] = [];
    for (const r of regReviews) {
      items.push({
        source: 'supplier_registration', sourceId: r.id, category: '注册审核',
        title: `注册审核：${r.displayName ?? r.username}`, applicant: r.displayName ?? r.username,
        submittedAt: r.reviewedAt ?? r.createdAt, deepLink: '/admin/accounts', status: r.decision,
      });
    }
    for (const r of pwChanges) {
      items.push({
        source: 'password_change', sourceId: r.id, category: '安全审批',
        title: '修改密码申请', applicant: r.user?.displayName ?? null,
        submittedAt: r.reviewedAt ?? r.requestedAt, deepLink: '/admin/accounts', status: r.status,
      });
    }
    for (const r of pwResets) {
      items.push({
        source: 'password_reset', sourceId: r.id, category: '安全审批',
        title: `忘记密码重置：${r.requestedUsername}`, applicant: r.applicantName ?? null,
        submittedAt: r.reviewedAt ?? r.requestedAt, deepLink: '/admin/accounts', status: r.status,
      });
    }
    for (const r of profileChanges) {
      items.push({
        source: 'profile_change', sourceId: r.id, category: '安全审批',
        title: '资料变更申请', applicant: r.user?.displayName ?? null,
        submittedAt: r.reviewedAt ?? r.requestedAt, deepLink: '/admin/accounts', status: r.status,
      });
    }
    for (const r of supChanges) {
      items.push({
        source: 'supplier_change', sourceId: r.id, category: '供应商变更',
        title: `${r.supplier?.name ?? '供应商'}变更「${r.fieldLabel ?? r.fieldName}」`,
        applicant: r.supplier?.name ?? null,
        submittedAt: r.reviewedAt ?? r.createdAt, deepLink: '/supplier/approval', status: r.status,
      });
    }
    for (const r of catalogApps) {
      items.push({
        source: 'catalog_application', sourceId: r.id, category: '商城审批',
        title: `目录申请：${r.supplier?.name ?? '供应商'}`,
        applicant: r.supplier?.name ?? null,
        submittedAt: r.updatedAt, deepLink: '/mall-management', status: r.status,
      });
    }
    return items.sort(byTimeDesc).slice(0, limit);
  }
}
