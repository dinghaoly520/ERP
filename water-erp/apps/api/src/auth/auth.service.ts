import { Injectable, NotFoundException, ConflictException, BadRequestException, UnauthorizedException, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { buildSessionMeta } from '../common/session-device.util';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { encryptPasswordVault } from './password-vault.util';
import { sealPii, openPii, openPiiForMask, blindIndexPii } from '../common/crypto/sm-field-crypto';
import { NotificationService } from '../notification/notification.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { findOpenEvaluationWindows } from '../expert/expert-room.util';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 登录时按来源门户（X-Portal）优先匹配的 role 顺序。
 * username 不再全局唯一（改为 [username, role] 复合唯一），允许跨 role 同名，
 * 登录时靠来源门户区分。
 * 采购管理端(:3005)已改用 ./procurement 账户体系，不走此优先级逻辑。
 */
const PORTAL_ROLE_PRIORITY: Record<string, string[]> = {
  supplier: ['supplier'],
  web: ['leader', 'staff', 'bid_host', 'admin'],
  expert: ['bid_expert', 'bid_host', 'admin'],
  public: ['leader', 'staff', 'supplier', 'bid_expert', 'bid_host', 'admin'],
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private verificationService: VerificationService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() @Inject(forwardRef(() => NotificationService))
    private readonly notifications?: NotificationService,
    // 会话轮换驱逐（2026-10-14）：rotatePortalSession 后断开旧 WS 通知订阅，防被踢页签
    // REST 全 401 却仍收推送弹窗（「通知可见、消息中心拉不到」悖论）
    @Optional() @Inject(forwardRef(() => NotificationGateway))
    private readonly notificationGateway?: NotificationGateway,
    // 公司名→Company 记录统一收口（2026-11-06 改公司全链路联动裁定）；
    // Optional 仅防测试直构，生产由 @Global CompanyScopeModule 提供
    @Optional() private readonly companyScope?: CompanyScopeService,
  ) {}

  async register(dto: RegisterDto) {
    // 口令不得与用户名相同（2026-11-09 注册页规则统一；跨字段校验 DTO 表达不了）
    if (dto.password === dto.username) {
      throw new BadRequestException({ error: '密码不能与用户名相同', code: 'PASSWORD_EQUALS_USERNAME' });
    }

    // ── 查重（三层）──
    // ① 待审核：手机号或用户名已有未激活的 internal_user 申请 → 拦截，提示等待。
    //    待审核期间资料不可修改/不可重复提交（申请已存在，拒绝后才可重新注册）。
    const phonePending = await this.prisma.user.findFirst({
      // phone 列存国密密文，等值查询走 HMAC-SM3 盲索引
      where: { phoneIdx: blindIndexPii(dto.phone) ?? undefined, role: 'internal_user', isActive: false },
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
      where: { phoneIdx: blindIndexPii(dto.phone) ?? undefined, isActive: true },
      select: { id: true },
    });
    if (phoneTaken) {
      throw new ConflictException({ error: '该手机号已绑定其他账号', code: 'PHONE_EXISTS' });
    }

    // ③ 已拒绝（已被删除，两处都查不到）→ 允许再次注册

    // 公司名归一化：公司是数据隔离的归属单位（2026-08-20 起对齐 Company 主数据），
    // 手输变体（漏「有限」、空格等）统一到已有规范写法；未命中的新公司入 Company 表建档。
    // 2026-11-06 收口到 CompanyScopeService.resolveCompanyRecord（company 文本与 companyId 成对写入）
    const companyRecord = await this.companyScope!.resolveCompanyRecord(dto.company);
    const company = companyRecord.name;

    // 验证手机验证码
    await this.verificationService.verifyRegistrationCode(dto.phone, dto.verificationCode);

    // 注册用户默认未激活（isActive=false），需管理员审核通过后才能登录。
    // 组织归属只记公司（company 文本），不做 Department 关联——现有部门均属
    // 四川水发勘测设计研究有限公司，后续会有其他公司注册，公司才是区分维度。
    const created = await this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        email: sealPii(dto.email) ?? null, // 国密密封（等保+密评）
        phone: sealPii(dto.phone) ?? null,
        phoneIdx: blindIndexPii(dto.phone) ?? null,
        company,
        companyId: companyRecord.id,
        officeLocation: dto.officeLocation,
        passwordHash: hashSync(dto.password, 10),
        passwordVault: encryptPasswordVault(dto.password) ?? null,
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
    // 先按用户名取「所有」同名账号（含未激活），按门户角色优先级选其一。供应商支持两种账号
    // （2026-09-24：信用代码→Supplier.creditCode / 企业全称→Supplier.name 精确反查 userId）。
    // 必须先验密码再判待审核——否则「错密码+未激活用户名」与「错密码+不存在」响应不同=用户名枚举；
    // passwordHash 仅本函数内用不外泄。用户名去前后空格（2026-10-27，:3006 8 连 401 实录——粘贴
    // 带空格致「查无此人」误导报错），与供应商别名分支同口径；密码不 trim（空格属口令）。
    const usernameInput = (dto.username ?? '').trim();
    const candidates = await this.prisma.user.findMany({
      where: { username: usernameInput },
      select: { id: true, username: true, role: true, isActive: true, isFrozen: true, isTempExpert: true, passwordHash: true },
    });

    // 供应商别名解析：按信用代码或企业全称反查（仅当按用户名未命中供应商角色时启用）
    if (!candidates.some((u) => u.role === 'supplier')) {
      const trimmed = usernameInput;
      if (trimmed) {
        const supplier = await this.prisma.supplier.findFirst({
          where: { OR: [{ creditCode: trimmed }, { name: trimmed }] },
          select: { userId: true },
        });
        if (supplier) {
          const aliasUser = await this.prisma.user.findUnique({
            where: { id: supplier.userId },
            select: { id: true, username: true, role: true, isActive: true, isFrozen: true, isTempExpert: true, passwordHash: true },
          });
          if (aliasUser) candidates.push(aliasUser);
        }
      }
    }

    const user =
      priority.map((role) => candidates.find((u) => u.role === role)).find(Boolean) ??
      candidates[0];
    // 密码错误/用户不存在 → 统一 null（不区分是否存在、是否待审核），杜绝枚举。
    if (!user || !user.passwordHash || !compareSync(dto.password, user.passwordHash)) {
      return null;
    }
    // 密码正确但账号未激活 → 专用码，引导前端走「查询审核进度」。此时已证明知道密码，不构成枚举。
    if (!user.isActive) {
      // 状态细化（2026-10-22 审计修复）：未激活 ≠ 一律「待审核」——按角色查权威状态源分流，
      // 否则退库专家/停用拉黑供应商被误报「账号待审核，尚未激活」。口径先例：TEMPORARY_EXPIRED。
      if (user.role === 'bid_expert') {
        // 专家分支终局三分（2026-10-26 用户口径：专家入库无需审核——建档即 isActive=true，
        // 不存在「待审核未激活」态）：退库/停用各回专属码，残缺态兜底也不得说「账号待审核」。
        const profile = await this.prisma.expertProfile.findUnique({
          where: { userId: user.id },
          select: { entryStatus: true, retiredAt: true, availability: true },
        });
        // retiredAt 兜底兼容历史路径漏写 entryStatus（同恢复路径口径）
        if (profile?.entryStatus === 'RETIRED' || profile?.retiredAt) {
          return { pending: true as const, role: user.role, code: 'ACCOUNT_RETIRED' };
        }
        // 停用（非退库）：setAvailability/批量停用置 isActive=false + availability=停用，
        // 不写退库字段（entryStatus 仍 ACTIVE）——曾漏网落 ACCOUNT_PENDING 误报「待审核」
        if (profile?.availability === '停用') {
          return { pending: true as const, role: user.role, code: 'EXPERT_DISABLED' };
        }
        return { pending: true as const, role: user.role, code: 'EXPERT_INACTIVE' };
      }
      if (user.role === 'supplier') {
        // 停用/拉黑联动 isActive=false（updateStatus）——不得误报「待审核」；
        // 驳回壳可在注册页重开、退回补正走注册页公开补正流程，文案须指路。
        const supplier = await this.prisma.supplier.findUnique({
          where: { userId: user.id },
          select: { status: true },
        });
        if (supplier?.status === 'DISABLED') {
          return { pending: true as const, role: user.role, code: 'ACCOUNT_DISABLED' };
        }
        if (supplier?.status === 'BLACKLIST') {
          return { pending: true as const, role: user.role, code: 'ACCOUNT_BLACKLISTED' };
        }
        if (supplier?.status === 'REJECTED') {
          return { pending: true as const, role: user.role, code: 'SUPPLIER_REJECTED' };
        }
        if (supplier?.status === 'RETURNED') {
          return { pending: true as const, role: user.role, code: 'SUPPLIER_RETURNED' };
        }
      }
      return { pending: true as const, role: user.role, code: 'ACCOUNT_PENDING' };
    }
    // 冻结账号（管理员在「账号管理」中冻结）→ 专用码，登录页提示「账号已被冻结」
    if (user.isFrozen) {
      return { pending: true as const, role: user.role, code: 'ACCOUNT_FROZEN' };
    }
    // 临时需求方代表（2026-11-05）：仅项目存续期可登录——须存在未终态（非 ARCHIVED/ABORTED）
    // 项目的 BidExpert 绑定（确认抽取时写入）。项目结束/归档/流标/终止/废标/重抽换人后即拒绝；
    // 录入后尚未确认抽取时同样无绑定不可登录（受邀入组才生效）。
    if (user.role === 'bid_expert' && user.isTempExpert) {
      const binding = await this.prisma.bidExpert.count({
        where: { userId: user.id, project: { stage: { notIn: ['ARCHIVED', 'ABORTED'] } } },
      });
      if (binding === 0) {
        return { pending: true as const, role: user.role, code: 'TEMP_ACCOUNT_EXPIRED' };
      }
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
      // 零归属登录闸（口径与文案单一来源 assertSupplierHasCompany）
      await this.assertSupplierHasCompany(user.id);
    }
    // 单设备登录（web 2026-08-21；supplier 2026-09-18；expert 2026-09-20）：轮换归 auth.controller
    // 条件块（cookiePortal ∈ 三门户时 rotatePortalSession——旧 token sid 与库中新值不一致，AuthGuard
    // 401 SESSION_REPLACED 互踢）。此前（93f4eaf8 起）此处无条件轮换，mall/bid 被静默赋予互踢+跨命名
    // 空间副作用（auth e2e mall 用例抓出）——bid/mall 恢复 issueToken（无 sid、不互踢）。
    return this.issueToken(user.id, user.username, user.role);
  }

  /** 零归属闸（2026-11-10 用户裁定）：无任何归属公司的供应商账号无法登录/续用。
   *  归属口径 = 存在非终态退出（非 WITHDRAWN/REJECTED）的 SupplierCompanyLink：
   *  在库（APPROVED）/公司停用（DISABLED，可恢复，须能登录看到指引）/加入审批中（PENDING）/
   *  退库审批中（LEAVE_PENDING，驳回则仍在库）均算；全部退光/从未通过任何归属审批才拦截。
   *  无 Supplier 行的裸账号（e2e 夹具形态）不适用。三个消费面单一来源：
   *  主登录 login()、CA 登录 ca-auth.controller、会话心跳 auth.controller heartbeat。 */
  async assertSupplierHasCompany(userId: string): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!supplier) return;
    const liveLinks = await this.prisma.supplierCompanyLink.count({
      where: { supplierId: supplier.id, status: { notIn: ['WITHDRAWN', 'REJECTED'] } },
    });
    if (liveLinks === 0) {
      throw new UnauthorizedException({
        error: '贵司已无任何归属公司，账号暂无法登录；如需恢复请咨询采购中心',
        code: 'SUPPLIER_NO_COMPANY',
      });
    }
  }

  async me(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        phone: true,
        officeLocation: true,
        company: true,
        companyId: true,
        avatar: true,
        role: true,
        isActive: true,
        isTempExpert: true,
        createdAt: true,
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });
    if (!me) return null;
    // 本人自视明文（email/phone 密文列拆封；本人数据本人可见，不入揭示审计）
    return { ...me, email: openPii(me.email), phone: openPii(me.phone) };
  }

  /** 通知管理员（leader/admin）有新注册待审核；link 带 userId 供审核完成后精确清除 */
  private async notifyAdminsPendingRegistration(userId: string, name: string, company: string, department: string, roleLabel: string) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: { in: ['admin', 'leader'] }, isActive: true },
        select: { id: true },
      });
      for (const admin of admins) {
        await (this.notifications ? this.notifications.create({
            userId: admin.id,
            type: 'USER_REGISTRATION_PENDING',
            title: '新用户注册待审核',
            content: `${name}（${company} · ${department}）申请${roleLabel}，等待审核。`,
            link: `/admin/accounts?tab=registration&userId=${userId}`,
          }) : this.prisma.notification.create({ data: {
            userId: admin.id,
            type: 'USER_REGISTRATION_PENDING',
            title: '新用户注册待审核',
            content: `${name}（${company} · ${department}）申请${roleLabel}，等待审核。`,
            link: `/admin/accounts?tab=registration&userId=${userId}`,
          } })).catch(() => {});
      }
    } catch { /* 通知失败不阻塞注册 */ }
  }

  /**
   * 注册审核完成后，清除所有管理员名下该用户的待审通知（resolvedAt 打标）。
   * 处理完即自动从「任务通知/待办」消失，无需逐条点击已读。
   * 锚点（2026-10-22 修复+加固）：创建侧 link 实为 /admin/accounts?tab=registration&userId=…，
   * 原全等匹配 ?userId= 永远对不上（只剩 content 兜底在干活）。改 endsWith 精确边界——
   * contains 会把「前缀相同的另一 id」（种子手工短 id 场景）误卷进来。
   */
  private async resolvePendingRegistrationNotifications(user: { id: string; displayName: string }) {
    try {
      await this.prisma.notification.updateMany({
        where: {
          type: 'USER_REGISTRATION_PENDING',
          resolvedAt: null,
          OR: [
            { link: { endsWith: `userId=${user.id}` } },
            { content: { contains: user.displayName } },
          ],
        },
        data: { resolvedAt: new Date() },
      });
    } catch { /* 清理失败不阻塞审核 */ }
  }

  /** 管理员审核：通过注册 —— 按申请权限映射正式角色（leader/staff），公司为唯一组织归属，并写入不可变审核记录。
   *  2026-09-14：可覆盖申请人自报权限（审核时管理员重新选择），缺省沿用 requestedRole。 */
  async approveUser(
    userId: string,
    reviewer?: { id: string; name?: string },
    overrideRole?: 'management' | 'office',
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException({ error: '用户不存在', code: 'NOT_FOUND' });
    if (user.isActive) throw new BadRequestException({ error: '用户已激活', code: 'ALREADY_ACTIVE' });

    // 权限→角色：管理权限→leader，办公权限→staff（:3005 PORTAL_ROLE_PRIORITY.web 的两个角色）
    const finalPermission = overrideRole ?? user.requestedRole ?? 'office';
    const finalRole = finalPermission === 'management' ? 'leader' : 'staff';

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
        await (this.notifications ? this.notifications.create({
            userId: admin.id,
            type: 'ACCOUNT_SECURITY_FEEDBACK',
            title: '账号异地登录反馈',
            content: `「${username}」反馈：账号被他人登录（IP：${ip ?? '未知'}），请核查并处理。`,
            link: `/admin/accounts?tab=list&keyword=${encodeURIComponent(username)}`,
          }) : this.prisma.notification.create({ data: {
            userId: admin.id,
            type: 'ACCOUNT_SECURITY_FEEDBACK',
            title: '账号异地登录反馈',
            content: `「${username}」反馈：账号被他人登录（IP：${ip ?? '未知'}），请核查并处理。`,
            link: `/admin/accounts?tab=list&keyword=${encodeURIComponent(username)}`,
          } })).catch(() => {});
      }
    } catch { /* 通知失败不阻塞反馈 */ }
  }

  /**
   * 工位锁定拒绝告警（P1-3 2026-09-21 审查修复）：spec §3 承诺的四路之一——
   * 冒名者反复撞登录时，监督日志高风险 + admin 站内信主动唤醒（而非事后翻 OperationLog）。
   */
  async alertSeatLockRejection(
    userId: string,
    username: string,
    windows: Array<{ projectId: string; projectName: string }>,
    ip?: string | null,
    userAgent?: string | null,
  ) {
    try {
      // 专家名显示（2026-10-28）：username ≠ 姓名的专家（CSV 导入显式「登录账号」列/录入自定义
      // 用户名）此前在告警里只看到账号串——按 userId 取 displayName 展示「姓名（账号 xxx）」，
      // 查不到回退 username；监督日志 target 同步用展示名（与 expert.service 的 target=
      // expertName 口径一致，target 是核验异常等读端的检索键）。
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      const display = (u?.displayName ?? '').trim() || username;
      const who = display === username ? display : `${display}（账号 ${username}）`;
      for (const w of windows) {
        await this.prisma.bidSupervisionLog.create({
          data: {
            projectId: w.projectId, time: new Date(), role: '评审专家', target: display,
            action: '评标期登录锁定拒绝',
            result: `评标窗口内的新登录被拒（IP ${ip ?? '未知'}；UA ${(userAgent ?? '').slice(0, 80)}）——如非本人换设备，疑似冒名登录（项目 ${w.projectName}）`,
            riskFlag: '高风险',
          },
        });
      }
      const admins = await this.prisma.user.findMany({
        where: { role: 'admin', isActive: true },
        select: { id: true },
      });
      for (const admin of admins) {
        await (this.notifications ? this.notifications.create({
            userId: admin.id,
            type: 'ACCOUNT_SECURITY_FEEDBACK',
            title: '专家账号评标期登录被拒',
            content: `「${who}」在评标期间尝试登录被工位锁定拒绝（IP：${ip ?? '未知'}）——若非本人换设备，疑似冒名，请在开评标端核实。`,
            link: '/bid',
          }) : this.prisma.notification.create({ data: {
            userId: admin.id,
            type: 'ACCOUNT_SECURITY_FEEDBACK',
            title: '专家账号评标期登录被拒',
            content: `「${who}」在评标期间尝试登录被工位锁定拒绝（IP：${ip ?? '未知'}）——若非本人换设备，疑似冒名，请在开评标端核实。`,
            link: '/bid',
          } })).catch(() => {});
      }
    } catch { /* 告警失败不阻塞拒绝本身 */ }
  }

  /** 写入注册审核历史（append-only，仅 create，不提供 update/delete） */
  private async writeRegistrationReview(
    user: { id: string; username: string; displayName: string; company: string | null; departmentName: string | null; phone: string | null; email: string | null; officeLocation: string | null; requestedRole: string | null },
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
    reviewer?: { id: string; name?: string },
  ) {
    // 操作留痕（2026-09-26）：AuditLog 供通知中心「操作历史」（registrationReview 表是业务审核历史）
    await this.prisma.auditLog.create({
      data: {
        userId: reviewer?.id ?? user.id,
        action: decision === 'APPROVED' ? 'USER_REGISTRATION_APPROVED' : 'USER_REGISTRATION_REJECTED',
        resourceType: '注册审核', resourceId: user.username,
        details: { note },
      },
    }).catch(() => {});
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

  /** 待审核注册用户列表（internal_user + 未激活）。
   *  phone/email 落库为国密密封密文（sm1:）——审批场景出口直接拆封明文（2026-10-12
   *  用户裁定：加密仅用于存储与浏览类点击揭示留痕，审批/申请/通知场景明文便于操作；
   *  此前裸出密文导致审核页联系方式列显示 sm1: 乱码）。 */
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
    }).then(rows => rows.map(r => ({
      ...r,
      // 宽容拆封：密封则拆、旧明文直通——单行坏数据不 500 整表
      phone: openPiiForMask(r.phone),
      email: openPiiForMask(r.email),
    })));
  }

  /** 审核历史（只读）。phone/email 为落库密封快照，出口拆封明文（审批场景，2026-10-12 用户裁定） */
  async listRegistrationReviews() {
    return this.prisma.registrationReview.findMany({
      orderBy: { reviewedAt: 'desc' },
    }).then(rows => rows.map(r => ({
      ...r,
      phone: openPiiForMask(r.phone) ?? '',
      email: openPiiForMask(r.email),
    })));
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
    // 改公司全链路联动（2026-11-06 用户裁定）：company 显示名与 companyId 真归属
    // （隔离/编号段/归属快照的依据）成对变更——只写一侧即名实分离。空串=成对清除。
    let companySync: { company: string | null; companyId: string | null } | undefined;
    if (dto.company !== undefined) {
      if (dto.company) {
        const rec = await this.companyScope!.resolveCompanyRecord(dto.company);
        companySync = { company: rec.name, companyId: rec.id };
      } else {
        companySync = { company: null, companyId: null };
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
        ...(companySync && { ...companySync }),
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

  /**
   * X-P1-02（2026-09-29 审查修复）：登出吊销仅适用于带 sid 的单设备会话
   * （web/supplier/expert 命名空间——rotatePortalSession 签发的 token 恒带 sid）。
   * token_bid 等无 sid 会话登出返回 false：不得清 webSessionId，否则 :3007 登出
   * 会误杀同账号在 :3005 的活会话（跨命名空间互杀）；无 sid 会话本就不校验此列。
   * 验签失败（过期/伪造）保守返回 false——登出仍清 cookie，只是不动库。
   */
  async shouldRevokeSession(token: string): Promise<boolean> {
    const payload = await this.jwt.verifyAsync<{ sid?: string }>(token).catch(() => null);
    return !!payload?.sid;
  }

  issueToken(sub: string, username: string, role: string, sid?: string) {
    const access_token = this.jwt.sign({ sub, username, role, ...(sid ? { sid } : {}) });    return { access_token, role, username, userId: sub };
  }

  /**
   * 单设备登录（web 2026-08-21；supplier 2026-09-18；expert 2026-09-20）：凡启用互踢的
   * 门户（token_web / token_supplier / token_expert 命名空间）每次登录轮换会话 ID。新 sid
   * 写入 User.webSessionId 并随 JWT 下发；AuthGuard 发现旧设备 token 的 sid 与库中不一致即
   * 401 SESSION_REPLACED——同一账号同一时间只有一台设备在线。角色↔门户互斥（supplier
   * 用户不可能产生 web 会话），各门户共用一列零冲突。token_bid 登录不轮换、不互踢。
   * expert 例外：评标窗口开（工位锁定）期间新登录被 auth.controller 直接 409 拒绝，不进入轮换。
   */
  async rotatePortalSession(userId: string, username: string, role: string, sessionMeta?: object) {
    const sid = randomUUID();
    await this.prisma.user.update({
      where: { id: userId },
      // sessionMeta：本次登录设备快照（deviceClass/uaSummary/ip/at）——与 sid 同一次写入，
      // 供主持人工位视图/解锁弹窗展示「当前在线设备」（2026-09-22）
      data: { webSessionId: sid, ...(sessionMeta !== undefined ? { sessionMeta } : {}) },
    });
    // 轮换即驱逐该账号全部既有 WS 通知订阅（2026-10-14）：此刻被断开的都是旧会话页签
    // （新会话在登录响应后才连 WS，带新 sid 正常入房；旧页签重连握手 sid 对账被拒）
    this.notificationGateway?.evictUser(userId);
    return this.issueToken(userId, username, role, sid);
  }

  /**
   * 闸4 工位锁定检查（2026-09-20 spec）：专家评标窗口开（签到起→报告确认止）且已有
   * 活动会话（webSessionId 非空）→ 锁定：新登录 409 ACCOUNT_EVALUATING 拒绝。
   * webSessionId 为空（主持人已 release-login-lock）→ 放行重新登录。
   */
  async checkExpertSeatLock(userId: string): Promise<{ locked: boolean; projectNames: string[]; windows: Array<{ projectId: string; projectName: string }> }> {
    const [user, windows] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { webSessionId: true } }),
      findOpenEvaluationWindows(this.prisma, userId),
    ]);
    return {
      locked: !!user?.webSessionId && windows.length > 0,
      projectNames: windows.map(w => w.project.name),
      windows: windows.map(w => ({ projectId: w.project.id, projectName: w.project.name })),
    };
  }

  /* ══ 工位迁移领取（2026-09-22 修正方案）：票据（免闸4）+ 密码重证（个人秘密绑定）→ 会话轮换 ══
   * @Public 端点（平板尚无会话）；票据 90s 单次 + 密码连错 3 次烧票。
   * 刻意不调 checkExpertSeatLock：这是已认证同人的会话迁移（桌面核验+口令全齐后签发），
   * 不是新登录——闸4 防的是冒名抢占，本路径的身份绑定由「票据签发前置核验 + 密码重证」承担。
   * 成功即 rotatePortalSession（新 sid 归平板、桌面旧 token 自然 401 SESSION_REPLACED），
   * 设备快照（sessionMeta）随轮换同写——主持人工位矩阵实时看到「在线设备」切换。 */
  async claimExpertTransfer(
    dto: { ticket: string; password: string },
    meta: { ip?: string | null; userAgent?: string | null },
  ) {
    if (!this.redis) throw new ServiceUnavailableException('Redis 不可用');
    const key = `expert-transfer:${dto.ticket}`;
    // 并发互斥（严格审查修复）：get→校验→del 之间存在竞态窗口，两请求可同时持票通过
    // （密码都对则双重轮换，单次语义被破坏）。按票据互斥锁串行化领取全程。
    const raw0 = await this.redis.get(key);
    if (!raw0) {
      throw new BadRequestException({ error: '迁移码已过期或已使用，请在桌面端重新生成', code: 'TICKET_INVALID' });
    }
    const t0 = JSON.parse(raw0) as { ticketId: string };
    const lockKey = `expert-transfer-lock:${t0.ticketId}`;
    const locked = await this.redis.set(lockKey, '1', 'EX', 15, 'NX');
    if (!locked) {
      throw new ConflictException({ error: '该迁移码正在领取中，请稍候重试', code: 'CLAIM_IN_PROGRESS' });
    }
    try {
      return await this.claimExpertTransferLocked(dto, meta, key);
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  private async claimExpertTransferLocked(
    dto: { ticket: string; password: string },
    meta: { ip?: string | null; userAgent?: string | null },
    key: string,
  ) {
    const redis = this.redis;
    if (!redis) throw new ServiceUnavailableException('Redis 不可用');
    const raw = await redis.get(key);
    if (!raw) {
      throw new BadRequestException({ error: '迁移码已过期或已使用，请在桌面端重新生成', code: 'TICKET_INVALID' });
    }
    const t = JSON.parse(raw) as { userId: string; expertName: string; projectId: string; sid: string; ticketId: string };
    const user = await this.prisma.user.findUnique({
      where: { id: t.userId },
      select: { id: true, username: true, role: true, isActive: true, isFrozen: true, isTempExpert: true, passwordHash: true, webSessionId: true },
    });
    if (!user || user.role !== 'bid_expert' || !user.isActive || user.isFrozen) {
      await redis.del(key);
      throw new BadRequestException({ error: '迁移码无效', code: 'TICKET_INVALID' });
    }
    // 临时需求方代表（2026-11-05）：claim 是独立入口不走 login 闸——同口径复核未终态绑定，
    // 防 90s 票据窗口内项目归档/流标后过期 temp 账号仍领票迁平板（会话 DOA）
    if (user.isTempExpert) {
      const binding = await this.prisma.bidExpert.count({
        where: { userId: user.id, project: { stage: { notIn: ['ARCHIVED', 'ABORTED'] } } },
      });
      if (binding === 0) {
        await redis.del(key);
        throw new UnauthorizedException({ error: '临时账号已随项目结束失效，请联系采购中心', code: 'TEMP_ACCOUNT_EXPIRED' });
      }
    }
    // 票据绑定签发时会话：桌面会话已被替换/吊销 → 票据随之作废（防旧票复用）
    if (!user.webSessionId || user.webSessionId !== t.sid) {
      await redis.del(key);
      throw new ConflictException({ error: '桌面会话已变化，迁移码失效，请重新生成', code: 'TICKET_STALE' });
    }
    // 密码重证：错 3 次烧票（票据是能力凭证，须防持票者暴力试密码）
    if (!user.passwordHash || !compareSync(dto.password, user.passwordHash)) {
      const aKey = `expert-transfer-attempts:${t.ticketId}`;
      const attempts = await redis.incr(aKey);
      await redis.expire(aKey, 90);
      if (attempts >= 3) {
        await redis.del(key);
        throw new BadRequestException({ error: '密码连续错误 3 次，迁移码已作废，请回桌面重新生成', code: 'TICKET_BURNED' });
      }
      throw new UnauthorizedException({ error: `登录密码错误（剩余 ${3 - attempts} 次机会）`, code: 'PASSWORD_MISMATCH' });
    }
    await redis.del(key); // 单次使用（成功即销毁）
    await redis.set(`expert-transfer-status:${t.ticketId}`, JSON.stringify({ userId: t.userId, status: 'claimed' }), 'EX', 180);
    // 严版（2026-09-23）：签到无留档照者迁移后强制补拍——置 pending，拍完/豁免跳过才清；
    // 服务端权威：photoRequired 时 recordTransferPhoto(skipped) 无豁免必 403
    const expert = await this.prisma.bidExpert.findFirst({
      where: { projectId: t.projectId, userId: t.userId },
      select: { signInMeta: true },
    });
    const signInMeta = (expert?.signInMeta ?? null) as { photoAssetId?: string | null } | null;
    const photoRequired = !signInMeta?.photoAssetId;
    if (photoRequired) {
      await this.prisma.bidExpert.updateMany({
        where: { projectId: t.projectId, userId: t.userId },
        // 豁免是逐次现场判定——新一轮迁移重新补拍要求，旧豁免不沿用
        data: { transferPhotoPendingAt: new Date(), transferPhotoExemptAt: null, transferPhotoExemptByName: null },
      });
    }
    const device = buildSessionMeta(meta.userAgent, meta.ip);
    const token = await this.rotatePortalSession(user.id, user.username, user.role, device);
    await this.prisma.bidSupervisionLog.create({
      data: {
        projectId: t.projectId, time: new Date(), role: '评审专家', target: t.expertName,
        action: '工位迁移',
        result: `桌面→平板工位迁移（迁移码单次使用，密码重证通过）；新设备 ${device.uaSummary}；原桌面会话已失效`,
        riskFlag: '无',
      },
    }).catch(() => {});
    return { access_token: token.access_token, role: user.role, username: user.username, projectId: t.projectId, photoRequired };
  }
}
