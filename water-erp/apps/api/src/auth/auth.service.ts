import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * 登录时按来源门户（X-Portal）优先匹配的 role 顺序。
 * username 不再全局唯一（改为 [username, role] 复合唯一），允许跨 role 同名，
 * 例如「陈主任」同时是商城(mall)/开标(bid_host)两个账号 —— 登录时靠来源门户区分。
 * 采购管理端(:3005)已改用 ./procurement 账户体系，不走此优先级逻辑。
 */
const PORTAL_ROLE_PRIORITY: Record<string, string[]> = {
  mall: ['mall'],
  supplier: ['supplier'],
  web: ['leader', 'staff', 'bid_host', 'admin'],
  expert: ['bid_expert', 'bid_host', 'admin'],
  public: ['leader', 'staff', 'supplier', 'bid_expert', 'bid_host', 'admin', 'mall'],
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private verificationService: VerificationService,
  ) {}

  async register(dto: RegisterDto) {
    // ── 查重（三层）──
    // ① 待审核：手机号或用户名已有未激活的 internal_user 申请 → 拦截，提示等待。
    //    待审核期间资料不可修改/不可重复提交（申请已存在，拒绝后才可重新注册）。
    const phonePending = await this.prisma.user.findFirst({
      where: { phone: dto.phone, role: 'internal_user', isActive: false },
      select: { id: true },
    });
    if (phonePending) {
      throw new ConflictException({ error: '该手机号的注册申请正在审核中，请耐心等待', code: 'REGISTRATION_PENDING' });
    }
    const usernamePending = await this.prisma.user.findFirst({
      where: { username: dto.username, role: 'internal_user', isActive: false },
      select: { id: true },
    });
    if (usernamePending) {
      throw new ConflictException({ error: '该用户名的注册申请正在审核中，请耐心等待', code: 'REGISTRATION_PENDING' });
    }

    // ② 用户名全局唯一（2026-08-24 收紧）：不限角色/激活状态，库里存在任何同名账号即拒绝
    const usernameTaken = await this.prisma.user.findFirst({
      where: { username: dto.username },
      select: { id: true },
    });
    if (usernameTaken) {
      throw new ConflictException({ error: '该用户名已被使用，请更换', code: 'USERNAME_EXISTS' });
    }
    const phoneTaken = await this.prisma.user.findFirst({
      where: { phone: dto.phone, isActive: true },
      select: { id: true },
    });
    if (phoneTaken) {
      throw new ConflictException({ error: '该手机号已绑定其他账号', code: 'PHONE_EXISTS' });
    }

    // ③ 已拒绝（已被删除，两处都查不到）→ 允许再次注册

    // 公司名归一化：公司是数据隔离的归属单位（2026-08-20 起对齐 Company 主数据），
    // 手输变体（漏「有限」、空格等）统一到已有规范写法；未命中的新公司入 Company 表建档
    const knownCompanies = await this.prisma.company.findMany({
      select: { name: true },
    }).then(rows => rows.map(r => r.name));
    const company = this.normalizeCompany(dto.company, knownCompanies);
    const companyRecord = await this.prisma.company.upsert({
      where: { name: company },
      update: {},
      create: { name: company },
    });

    // 验证手机验证码
    await this.verificationService.verifyRegistrationCode(dto.phone, dto.verificationCode);

    // 注册用户默认未激活（isActive=false），需管理员审核通过后才能登录。
    // 组织归属只记公司（company 文本），不做 Department 关联——现有部门均属
    // 四川水发勘测设计研究有限公司，后续会有其他公司注册，公司才是区分维度。
    const created = await this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        email: dto.email,
        phone: dto.phone,
        company,
        companyId: companyRecord.id,
        officeLocation: dto.officeLocation,
        passwordHash: hashSync(dto.password, 10),
        role: 'internal_user',
        isActive: false,
        requestedRole: dto.requestedRole,
        departmentName: dto.department.trim(),
      },
    });

    // 通知管理员有新注册待审核
    const roleLabel = dto.requestedRole === 'management' ? '管理权限' : '办公权限';
    await this.notifyAdminsPendingRegistration(created.id, dto.displayName, company, dto.department, roleLabel);

    return { pending: true as const };
  }

  async login(dto: LoginDto, portal?: string) {
    const priority = (portal && PORTAL_ROLE_PRIORITY[portal]) || PORTAL_ROLE_PRIORITY.public;
    // 先按用户名取「所有」同名账号（含未激活），按门户角色优先级选其一。
    // 关键：必须先校验密码，密码正确后才判断是否待审核——否则「错密码+存在未激活用户名」与
    // 「错密码+用户名不存在」响应不同，会构成用户名枚举。passwordHash 仅在此函数内使用，不外泄。
    const candidates = await this.prisma.user.findMany({
      where: { username: dto.username },
      select: { id: true, username: true, role: true, isActive: true, isFrozen: true, passwordHash: true },
    });
    const user =
      priority.map((role) => candidates.find((u) => u.role === role)).find(Boolean) ??
      candidates[0];
    // 密码错误/用户不存在 → 统一 null（不区分是否存在、是否待审核），杜绝枚举。
    if (!user || !user.passwordHash || !compareSync(dto.password, user.passwordHash)) {
      return null;
    }
    // 密码正确但账号未激活 → 专用码，引导前端走「查询审核进度」。此时已证明知道密码，不构成枚举。
    if (!user.isActive) {
      return { pending: true as const, role: user.role, code: 'ACCOUNT_PENDING' };
    }
    // 冻结账号（管理员在「账号管理」中冻结）→ 专用码，登录页提示「账号已被冻结」
    if (user.isFrozen) {
      return { pending: true as const, role: user.role, code: 'ACCOUNT_FROZEN' };
    }
    // 临时供应商过期拦截：邀请码绑定的有效期已过则禁止登录（与未激活一样走 pending 分支）
    if (user.role === 'supplier') {
      const supplier = await this.prisma.supplier.findUnique({
        where: { userId: user.id },
        select: { isTemporary: true, temporaryExpiresAt: true },
      });
      if (supplier?.isTemporary && supplier.temporaryExpiresAt && supplier.temporaryExpiresAt < new Date()) {
        return { pending: true as const, role: user.role, code: 'TEMPORARY_EXPIRED' };
      }
    }
    return this.issueToken(user.id, user.username, user.role);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        phone: true,
        officeLocation: true,
        company: true,
        avatar: true,
        role: true,
        isActive: true,
        createdAt: true,
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });
  }

  /** 公司名归一化：精确匹配（忽略大小写/空白）→ 去后缀模糊匹配（有限/股份/集团）→ 原样保留 */
  private normalizeCompany(input: string, known: string[]): string {
    const trimmed = input.trim().replace(/\s+/g, '');
    const exact = known.find(c => c.toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact;
    const stripSuffix = (s: string) => s.replace(/(股份有限公司|有限公司|有限责任公司|集团)$/, '');
    const target = stripSuffix(trimmed);
    const fuzzy = known.find(c => stripSuffix(c) === target);
    return fuzzy ?? trimmed;
  }

  /** 通知管理员（leader/admin）有新注册待审核；link 带 userId 供审核完成后精确清除 */
  private async notifyAdminsPendingRegistration(userId: string, name: string, company: string, department: string, roleLabel: string) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: { in: ['admin', 'leader'] }, isActive: true },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'USER_REGISTRATION_PENDING',
            title: '新用户注册待审核',
            content: `${name}（${company} · ${department}）申请${roleLabel}，等待审核。`,
            link: `/admin/accounts?userId=${userId}`,
          },
        });
      }
    } catch { /* 通知失败不阻塞注册 */ }
  }

  /**
   * 注册审核完成后，清除所有管理员名下该用户的待审通知（resolvedAt 打标）。
   * 处理完即自动从「任务通知/待办」消失，无需逐条点击已读。
   * 锚点：新通知按 link?userId= 精确匹配；存量通知（link 无 userId）按 content 含 displayName 兜底。
   */
  private async resolvePendingRegistrationNotifications(user: { id: string; displayName: string }) {
    try {
      await this.prisma.notification.updateMany({
        where: {
          type: 'USER_REGISTRATION_PENDING',
          resolvedAt: null,
          OR: [
            { link: `/admin/accounts?userId=${user.id}` },
            { content: { contains: user.displayName } },
          ],
        },
        data: { resolvedAt: new Date() },
      });
    } catch { /* 清理失败不阻塞审核 */ }
  }

  /** 管理员审核：通过注册 —— 按申请权限映射正式角色（leader/staff），公司为唯一组织归属，并写入不可变审核记录 */
  async approveUser(userId: string, reviewer?: { id: string; name?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException({ error: '用户不存在', code: 'NOT_FOUND' });
    if (user.isActive) throw new BadRequestException({ error: '用户已激活', code: 'ALREADY_ACTIVE' });

    // 权限→角色：管理权限→leader，办公权限→staff（:3005 PORTAL_ROLE_PRIORITY.web 的两个角色）
    const finalRole = user.requestedRole === 'management' ? 'leader' : 'staff';

    // 写库：激活 + 定角色。[username, role] 复合唯一，撞名抛 P2002 → 409
    let updated;
    try {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: { isActive: true, role: finalRole },
        select: { id: true, username: true, role: true, company: true },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({
          error: `用户名「${user.username}」已有同角色账号，无法变更为 ${finalRole}`,
          code: 'USERNAME_ROLE_CONFLICT',
        });
      }
      throw e;
    }

    await this.writeRegistrationReview(user, 'APPROVED', null, reviewer);
    // 审核完成 → 清除各管理员的待审通知（待办自动消）
    await this.resolvePendingRegistrationNotifications(user);
    return { ok: true, user: updated };
  }

  /** 管理员审核：拒绝注册（删除用户），并写入不可变审核记录 */
  async rejectUser(userId: string, reviewer?: { id: string; name?: string }, note?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException({ error: '用户不存在', code: 'NOT_FOUND' });
    if (user.isActive) throw new BadRequestException({ error: '用户已激活，无法拒绝', code: 'ALREADY_ACTIVE' });
    await this.prisma.user.delete({ where: { id: userId } });
    await this.writeRegistrationReview(user, 'REJECTED', note ?? null, reviewer);
    // 审核完成 → 清除各管理员的待审通知（待办自动消）
    await this.resolvePendingRegistrationNotifications(user);
    return { ok: true };
  }

  /** 被顶下线设备的「反馈」：通知所有管理员到「账号管理」核查处理（通知失败不阻塞反馈） */
  async notifySecurityFeedback(username: string, ip?: string | null, userAgent?: string | null) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'admin', isActive: true },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'ACCOUNT_SECURITY_FEEDBACK',
            title: '账号异地登录反馈',
            content: `「${username}」反馈：账号被他人登录（IP：${ip ?? '未知'}），请核查并处理。`,
            link: '/admin/accounts',
          },
        });
      }
    } catch { /* 通知失败不阻塞反馈 */ }
  }

  /** 写入注册审核历史（append-only，仅 create，不提供 update/delete） */
  private async writeRegistrationReview(
    user: { id: string; username: string; displayName: string; company: string | null; departmentName: string | null; phone: string | null; email: string | null; officeLocation: string | null; requestedRole: string | null },
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
    reviewer?: { id: string; name?: string },
  ) {
    await this.prisma.registrationReview.create({
      data: {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        company: user.company ?? '',
        department: user.departmentName,
        phone: user.phone ?? '',
        email: user.email,
        officeLocation: user.officeLocation,
        requestedRole: user.requestedRole ?? '',
        decision,
        decisionNote: note,
        reviewedById: reviewer?.id,
        reviewedByName: reviewer?.name,
        reviewedAt: new Date(),
      },
    });
  }

  /** 待审核注册用户列表（internal_user + 未激活） */
  async listPendingRegistrations() {
    return this.prisma.user.findMany({
      where: { role: 'internal_user', isActive: false },
      select: {
        id: true,
        username: true,
        displayName: true,
        company: true,
        departmentName: true,
        phone: true,
        email: true,
        officeLocation: true,
        requestedRole: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 审核历史（只读） */
  async listRegistrationReviews() {
    return this.prisma.registrationReview.findMany({
      orderBy: { reviewedAt: 'desc' },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!dept) {
        throw new NotFoundException('指定的部门不存在');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.officeLocation !== undefined && { officeLocation: dto.officeLocation }),
        ...(dto.company !== undefined && { company: dto.company }),
        ...(dto.avatar !== undefined && { avatar: dto.avatar }),
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        phone: true,
        avatar: true,
        officeLocation: true,
        company: true,
        role: true,
        isActive: true,
        createdAt: true,
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return updated;
  }

  issueToken(sub: string, username: string, role: string, sid?: string) {
    const access_token = this.jwt.sign({ sub, username, role, ...(sid ? { sid } : {}) });
    return { access_token, role, username, userId: sub };
  }

  /**
   * :3005 单设备登录（2026-08-21）：web 门户（token_web 命名空间）每次登录轮换会话 ID。
   * 新 sid 写入 User.webSessionId 并随 JWT 下发；AuthGuard 发现旧设备 token 的 sid
   * 与库中不一致即 401 SESSION_REPLACED —— 同一账号同一时间只有一台设备在线。
   * 仅 cookiePortal==='web' 时调用（:3006 分流写 token_bid 的登录不轮换、不互踢）。
   */
  async rotateWebSession(userId: string, username: string, role: string) {
    const sid = randomUUID();
    await this.prisma.user.update({
      where: { id: userId },
      data: { webSessionId: sid },
    });
    return this.issueToken(userId, username, role, sid);
  }
}
