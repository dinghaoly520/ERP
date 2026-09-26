import { Injectable, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException, Inject, forwardRef, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { compareSync, hashSync } from 'bcryptjs';
import { encryptPasswordVault } from './password-vault.util';
import { PrismaService } from '../prisma/prisma.service';
import { PASSWORD_PATTERN } from '../common/validators/password-strength';
import { VerificationService } from '../verification/verification.service';
import { NotificationService } from '../notification/notification.service';

/**
 * 密码变更/重置申请（2026-08-21 补齐后端实现）：
 * 前端「密码审批」页面与个人中心改密、登录页忘记密码此前调用的端点一直没有后端
 * （404 Cannot GET）。模型早已存在（PasswordChangeRequest / PasswordResetRequest），
 * 本服务补齐「提交申请 → 管理员审批」闭环；批准改密/重置都会吊销 web 会话强制重登。
 */
@Injectable()
export class PasswordRequestsService {
  /** 资料字段中文名（通知摘要用，与前端 PROFILE_FIELD_LABELS 对齐） */
  static readonly PROFILE_FIELD_LABELS: Record<string, string> = {
    displayName: '姓名',
    email: '邮箱',
    phone: '手机',
    officeLocation: '办公位置',
    company: '公司',
    departmentId: '部门',
    avatar: '头像',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationService: VerificationService,
    // 资料变更通知（2026-09-22，走 NotificationService=含 WS 实时推送）；Optional 防测试环境
    @Optional() @Inject(forwardRef(() => NotificationService))
    private readonly notifications?: NotificationService,
  ) {}

  // ── 用户端：提交申请 ──

  /** 登录用户提交改密申请（个人中心）：校验当前密码，新密码待管理员审批后生效 */
  async submitChange(userId: string, currentPassword: string, newPassword: string) {
    if (!PASSWORD_PATTERN.test(newPassword)) {
      throw new BadRequestException({ error: '新口令须至少 8 位且同时包含字母与数字', code: 'PASSWORD_WEAK' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !compareSync(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException({ error: '当前密码不正确', code: 'CURRENT_PASSWORD_WRONG' });
    }
    if (compareSync(newPassword, user.passwordHash)) {
      throw new BadRequestException({ error: '新密码不能与当前密码相同', code: 'PASSWORD_UNCHANGED' });
    }
    // 同一用户已有待审批申请 → 覆盖式拒绝旧的，只保留最新一条
    await this.prisma.passwordChangeRequest.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'REJECTED', decisionNote: '已提交新的改密申请，本条自动关闭', reviewedAt: new Date() },
    });
    return this.prisma.passwordChangeRequest.create({
      data: { userId, requestedPasswordHash: hashSync(newPassword, 10), requestedPasswordVault: encryptPasswordVault(newPassword) ?? null },
      select: { id: true, status: true, requestedAt: true },
    });
  }

  /** 忘记密码重置申请（登录页，匿名）：不泄露账号是否存在，统一返回成功 */
  async submitReset(username: string, applicantName: string, applicantContact: string, verificationCode: string, newPassword: string) {
    await this.verificationService.verifyRegistrationCode(applicantContact, verificationCode);
    const normalized = hashSync(newPassword, 10);
    const matched = await this.prisma.user.findFirst({
      where: { username, isActive: true },
      select: { id: true, passwordHash: true },
    });
    const created = await this.prisma.passwordResetRequest.create({
      data: {
        requestedUsername: username,
        applicantName,
        applicantContact,
        matchedUserId: matched?.id ?? null,
        requestedPasswordHash: normalized,
        requestedPasswordVault: encryptPasswordVault(newPassword) ?? null,
      },
      // 匿名响应不返回 matchedUserId，避免用接口枚举真实账号。
      select: { id: true, status: true, requestedAt: true },
    });
    return created;
  }

  // ── 管理端：审批 ──

  listPendingChanges() {
    return this.prisma.passwordChangeRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        decisionNote: true,
        user: {
          select: { id: true, username: true, displayName: true, email: true, phone: true, role: true, company: true },
        },
      },
    });
  }

  /** 列表口径：supplier = 仅匹配到供应商账号的重置申请（:3005 供应商管理中心审批）；
   *  internal = 其余（含未匹配到账号的，留 :3005 账号管理·安全审批处理）。 */
  listPendingResets(scope: 'supplier' | 'internal' = 'internal') {
    const where =
      scope === 'supplier'
        ? { status: 'PENDING' as const, matchedUser: { is: { role: 'supplier' as const } } }
        : {
            status: 'PENDING' as const,
            OR: [{ matchedUser: { is: { role: { not: 'supplier' as const } } } }, { matchedUserId: null }],
          };
    return this.prisma.passwordResetRequest.findMany({
      where,
      orderBy: { requestedAt: 'asc' },
      select: {
        id: true,
        requestedUsername: true,
        applicantName: true,
        applicantContact: true,
        status: true,
        requestedAt: true,
        decisionNote: true,
        matchedUser: {
          select: { id: true, username: true, displayName: true, email: true, phone: true, role: true, company: true },
        },
      },
    });
  }

  /** 批准改密：新密码生效并吊销该账号全部 web 会话 */
  async approveChange(id: string, reviewerId: string) {
    const req = await this.prisma.passwordChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (req.status !== 'PENDING') throw new BadRequestException({ error: '该申请已处理', code: 'ALREADY_REVIEWED' });
    await this.prisma.user.update({
      where: { id: req.userId },
      data: {
        passwordHash: req.requestedPasswordHash,
        // 旧申请（无副本字段）不清空已有 vault；审批通过后保持「最新版可查看」
        ...(req.requestedPasswordVault ? { passwordVault: req.requestedPasswordVault } : {}),
        webSessionId: null,
        sessionMeta: Prisma.DbNull,
      },
    });
    // 通知申请人审批结果（与资料变更审批对齐；通知失败不阻塞审批）
    try {
      await (this.notifications ? this.notifications.create({
          userId: req.userId,
          type: 'PASSWORD_CHANGE_REVIEWED',
          title: '密码修改已通过',
          content: '您的密码修改申请已由管理员审核通过，新密码已生效；当前登录已失效，请使用新密码重新登录。',
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        }) : this.prisma.notification.create({ data: {
          userId: req.userId,
          type: 'PASSWORD_CHANGE_REVIEWED',
          title: '密码修改已通过',
          content: '您的密码修改申请已由管理员审核通过，新密码已生效；当前登录已失效，请使用新密码重新登录。',
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        } })).catch(() => {});
    } catch { /* 通知失败不阻塞审批 */ }
    return this.prisma.passwordChangeRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedAt: new Date(), approvedById: reviewerId },
      select: { id: true, status: true, reviewedAt: true },
    });
  }

  async rejectChange(id: string, reviewerId: string, note?: string) {
    const req = await this.prisma.passwordChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (req.status !== 'PENDING') throw new BadRequestException({ error: '该申请已处理', code: 'ALREADY_REVIEWED' });
    // 拒绝必须让申请人知晓，否则个人中心永远停在「等待审批」
    try {
      await (this.notifications ? this.notifications.create({
          userId: req.userId,
          type: 'PASSWORD_CHANGE_REVIEWED',
          title: '密码修改未通过',
          content: `您的密码修改申请被拒绝${note ? `：${note}` : ''}，原密码继续有效。`,
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        }) : this.prisma.notification.create({ data: {
          userId: req.userId,
          type: 'PASSWORD_CHANGE_REVIEWED',
          title: '密码修改未通过',
          content: `您的密码修改申请被拒绝${note ? `：${note}` : ''}，原密码继续有效。`,
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        } })).catch(() => {});
    } catch { /* 通知失败不阻塞审批 */ }
    return this.prisma.passwordChangeRequest.update({
      where: { id },
      data: { status: 'REJECTED', decisionNote: note ?? null, reviewedAt: new Date(), approvedById: reviewerId },
      select: { id: true, status: true, reviewedAt: true, decisionNote: true },
    });
  }

  /** 供应商口径守卫：经供应商管理端审批的申请必须匹配到供应商账号，
   *  防止 staff 经 supplier 端点越权处理内部账号的重置申请。 */
  private async assertSupplierScope(id: string, scope?: 'supplier') {
    if (!scope) return null;
    const req = await this.prisma.passwordResetRequest.findUnique({
      where: { id },
      select: { matchedUser: { select: { role: true } } },
    });
    if (!req || req.matchedUser?.role !== 'supplier') {
      throw new ForbiddenException({ error: '该申请不属于供应商密码重置范围', code: 'NOT_SUPPLIER_REQUEST' });
    }
    return req;
  }

  /** 批准重置：按申请人填写的新密码更新账号，并吊销 web 会话 */
  async approveReset(id: string, reviewerId: string, scope?: 'supplier') {
    await this.assertSupplierScope(id, scope);
    const req = await this.prisma.passwordResetRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (req.status !== 'PENDING') throw new BadRequestException({ error: '该申请已处理', code: 'ALREADY_REVIEWED' });
    if (!req.matchedUserId) {
      throw new BadRequestException({ error: '未匹配到有效账号，无法完成重置', code: 'NO_MATCHED_USER' });
    }
    if (!req.requestedPasswordHash) {
      throw new BadRequestException({ error: '未检测到有效的新密码，请提交完整申请', code: 'NO_REQUESTED_PASSWORD' });
    }
    await this.prisma.user.update({
      where: { id: req.matchedUserId },
      data: {
        passwordHash: req.requestedPasswordHash,
        ...(req.requestedPasswordVault ? { passwordVault: req.requestedPasswordVault } : {}),
        webSessionId: null,
        sessionMeta: Prisma.DbNull,
      },
    });
    try {
      await (this.notifications ? this.notifications.create({
          userId: req.matchedUserId,
          type: 'PASSWORD_RESET_APPROVED',
          title: '忘记密码申请已通过',
          content: '您的忘记密码申请已通过审核，管理员已将密码按你提交内容重置；请尽快登录并再次修改。',
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        }) : this.prisma.notification.create({ data: {
          userId: req.matchedUserId,
          type: 'PASSWORD_RESET_APPROVED',
          title: '忘记密码申请已通过',
          content: '您的忘记密码申请已通过审核，管理员已将密码按你提交内容重置；请尽快登录并再次修改。',
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        } })).catch(() => {});
    } catch {
      // 通知失败不阻塞审批
    }
    return this.prisma.passwordResetRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: reviewerId },
      select: { id: true, status: true, reviewedById: true, reviewedAt: true },
    });
  }

  async rejectReset(id: string, reviewerId: string, note?: string, scope?: 'supplier') {
    await this.assertSupplierScope(id, scope);
    const req = await this.prisma.passwordResetRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (req.status !== 'PENDING') throw new BadRequestException({ error: '该申请已处理', code: 'ALREADY_REVIEWED' });
    return this.prisma.passwordResetRequest.update({
      where: { id },
      data: { status: 'REJECTED', decisionNote: note ?? null, reviewedAt: new Date(), reviewedById: reviewerId },
      select: { id: true, status: true, reviewedAt: true, decisionNote: true },
    });
  }

  // ── 资料变更申请（2026-08-24）：个人中心所有资料修改一律走审批 ──

  /** payload 允许修改的字段白名单（与个人中心表单一致） */
  private static readonly PROFILE_FIELDS = [
    'displayName', 'email', 'phone', 'officeLocation', 'company', 'departmentId', 'avatar',
  ] as const;

  /** 登录用户提交资料变更申请：校验字段白名单、与当前值确有差异，重复提交自动关闭旧申请 */
  async submitProfileChange(userId: string, payload: Record<string, string | null>) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        displayName: true, email: true, phone: true, officeLocation: true,
        company: true, departmentId: true, avatar: true,
        role: true, // 2026-09-26 审批分流：供应商申请人 → 归属公司管理账号；管理端申请人 → admin
      },
    });
    if (!user) throw new NotFoundException({ error: '账号不存在', code: 'NOT_FOUND' });

    // 只保留白名单内、且与当前值不同的字段
    const changes: Record<string, string | null> = {};
    for (const field of PasswordRequestsService.PROFILE_FIELDS) {
      if (!(field in payload)) continue;
      const next = payload[field];
      const current = user[field] ?? '';
      if ((next ?? '') !== current) changes[field] = next;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({ error: '资料没有发生变化', code: 'NO_CHANGES' });
    }
    if (changes.displayName !== undefined && !changes.displayName?.trim()) {
      throw new BadRequestException({ error: '姓名不能为空', code: 'NAME_REQUIRED' });
    }

    await this.prisma.profileChangeRequest.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'REJECTED', decisionNote: '已提交新的资料变更申请，本条自动关闭', reviewedAt: new Date() },
    });
    const created = await this.prisma.profileChangeRequest.create({
      data: { userId, payload: changes },
      select: { id: true, status: true, requestedAt: true },
    });

    // 2026-09-22：资料变更必须通知审批人（此前静默无感知不合理）
    // 2026-09-26 分流（用户裁定）：供应商申请人 → 其归属公司管理账号（leader+staff，无人回退 admin）；
    // 管理端申请人 → 平台 admin（admin 只管管理端账号的注册与修改）
    const applicantIsSupplier = user.role === 'supplier';
    let approverIds: string[] = [];
    if (applicantIsSupplier) {
      const supplierRow = await this.prisma.supplier.findUnique({ where: { userId }, select: { companyId: true } }).catch(() => null);
      if (supplierRow?.companyId) {
        const companyApprovers = await this.prisma.user.findMany({
          where: { role: { in: ['leader', 'staff'] }, isActive: true, companyId: supplierRow.companyId },
          select: { id: true },
        });
        approverIds = companyApprovers.map(u => u.id);
      }
      if (approverIds.length === 0) {
        approverIds = (await this.prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } })).map(u => u.id);
      }
    } else {
      approverIds = (await this.prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } })).map(u => u.id);
    }
    const summary = Object.keys(changes)
      .map((f) => PasswordRequestsService.PROFILE_FIELD_LABELS[f] ?? f)
      .join('、');
    for (const a of approverIds.map(id => ({ id }))) {
      const body = {
        userId: a.id,
        type: 'PROFILE_CHANGE_PENDING',
        title: '资料变更待审批',
        content: `「${user.displayName}」提交了资料变更（${summary}），请前往账号管理审批。`,
        link: '/admin/accounts?tab=password&section=profile',
      };
      // NotificationService.create = 落库 + WS 实时推送（右下角弹窗）；降级 prisma 直建
      await (this.notifications
        ? this.notifications.create(body)
        : this.prisma.notification.create({ data: body })
      ).catch(() => { /* 通知失败不阻塞申请 */ });
    }

    return created;
  }

  listPendingProfileChanges() {
    return this.prisma.profileChangeRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
      select: {
        id: true,
        payload: true,
        status: true,
        requestedAt: true,
        decisionNote: true,
        user: {
          // 当前值 = 旧值对照（批准前用户资料未变）；department 关系用于把裸 cuid 翻译成部门名
          select: {
            id: true, username: true, displayName: true, email: true, phone: true,
            officeLocation: true, company: true, departmentId: true, avatar: true, role: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /** 批准资料变更：白名单字段应用到 User（null = 清除），并通知申请人 */
  async approveProfileChange(id: string, reviewerId: string) {
    const req = await this.prisma.profileChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (req.status !== 'PENDING') throw new BadRequestException({ error: '该申请已处理', code: 'ALREADY_REVIEWED' });

    const payload = (req.payload ?? {}) as Record<string, string | null>;
    const data: Record<string, string | null> = {};
    for (const field of PasswordRequestsService.PROFILE_FIELDS) {
      if (field in payload) data[field] = payload[field];
    }
    const updated = await this.prisma.user.update({
      where: { id: req.userId },
      data,
      select: { username: true },
    });

    // 通知申请人审批结果
    try {
      await (this.notifications ? this.notifications.create({
          userId: req.userId,
          type: 'PROFILE_CHANGE_REVIEWED',
          title: '资料变更已通过',
          content: '您的资料修改申请已由管理员审核通过，新资料已生效。',
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        }) : this.prisma.notification.create({ data: {
          userId: req.userId,
          type: 'PROFILE_CHANGE_REVIEWED',
          title: '资料变更已通过',
          content: '您的资料修改申请已由管理员审核通过，新资料已生效。',
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        } })).catch(() => {});
    } catch { /* 通知失败不阻塞审批 */ }

    // 2026-09-26 五段状态：审批人待办消音（新旧 link 双口径）+ 操作留痕（操作历史/已办结果依据）
    await Promise.allSettled([
      this.notifications?.resolveActionable('PROFILE_CHANGE_PENDING', '/admin/accounts?tab=password&section=profile'),
      this.notifications?.resolveActionable('PROFILE_CHANGE_PENDING', '/admin/accounts'),
      this.prisma.auditLog.create({ data: {
        userId: reviewerId, action: 'PROFILE_CHANGE_APPROVED',
        resourceType: '资料变更审批', resourceId: updated.username,
        details: { requestId: id, fields: Object.keys(payload) },
      } }),
    ]);

    return this.prisma.profileChangeRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: reviewerId },
      select: { id: true, status: true, reviewedAt: true },
    }).then((result) => ({ ...result, username: updated.username }));
  }

  async rejectProfileChange(id: string, reviewerId: string, note?: string) {
    const req = await this.prisma.profileChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: '申请不存在', code: 'NOT_FOUND' });
    if (req.status !== 'PENDING') throw new BadRequestException({ error: '该申请已处理', code: 'ALREADY_REVIEWED' });

    try {
      await (this.notifications ? this.notifications.create({
          userId: req.userId,
          type: 'PROFILE_CHANGE_REVIEWED',
          title: '资料变更未通过',
          content: `您的资料修改申请被拒绝${note ? `：${note}` : ''}，当前资料保持不变。`,
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        }) : this.prisma.notification.create({ data: {
          userId: req.userId,
          type: 'PROFILE_CHANGE_REVIEWED',
          title: '资料变更未通过',
          content: `您的资料修改申请被拒绝${note ? `：${note}` : ''}，当前资料保持不变。`,
          link: '/profile?edit=1', // 落地即打开基本资料编辑弹窗
        } })).catch(() => {});
    } catch { /* 通知失败不阻塞审批 */ }

    // 2026-09-26 五段状态：审批人待办消音 + 操作留痕
    const reqUser = await this.prisma.user.findUnique({ where: { id: req.userId }, select: { username: true } }).catch(() => null);
    await Promise.allSettled([
      this.notifications?.resolveActionable('PROFILE_CHANGE_PENDING', '/admin/accounts?tab=password&section=profile'),
      this.notifications?.resolveActionable('PROFILE_CHANGE_PENDING', '/admin/accounts'),
      this.prisma.auditLog.create({ data: {
        userId: reviewerId, action: 'PROFILE_CHANGE_REJECTED',
        resourceType: '资料变更审批', resourceId: reqUser?.username ?? req.userId,
        details: { requestId: id, reason: note ?? null },
      } }),
    ]);

    return this.prisma.profileChangeRequest.update({
      where: { id },
      data: { status: 'REJECTED', decisionNote: note ?? null, reviewedAt: new Date(), reviewedById: reviewerId },
      select: { id: true, status: true, reviewedAt: true, decisionNote: true },
    });
  }
}
