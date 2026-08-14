import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
    // 查重：register 默认创建 role=internal_user，命中 [username, role] 唯一约束会抛 P2002（原返回 500）→ 归一化为 409
    const existing = await this.prisma.user.findFirst({
      where: { username: dto.username, role: 'internal_user' },
    });
    if (existing) {
      throw new ConflictException({ error: '账号已存在', code: 'USERNAME_EXISTS' });
    }

    // 验证手机验证码
    await this.verificationService.verifyRegistrationCode(dto.phone, dto.verificationCode);

    // 按部门名查找 Department（找不到则留空，管理员后续指派）
    let departmentId: string | undefined;
    const dept = await this.prisma.department.findFirst({
      where: { name: { contains: dto.department.trim(), mode: 'insensitive' } },
    });
    if (dept) departmentId = dept.id;

    // 注册用户默认未激活（isActive=false），需管理员审核通过后才能登录
    await this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        officeLocation: dto.officeLocation,
        passwordHash: hashSync(dto.password, 10),
        role: 'internal_user',
        isActive: false,
        departmentId,
      },
    });

    // 通知管理员有新注册待审核
    const roleLabel = dto.requestedRole === 'management' ? '管理权限' : '办公权限';
    await this.notifyAdminsPendingRegistration(dto.displayName, dto.company, dto.department, roleLabel);

    return { pending: true as const };
  }

  async login(dto: LoginDto, portal?: string) {
    const priority = (portal && PORTAL_ROLE_PRIORITY[portal]) || PORTAL_ROLE_PRIORITY.public;
    // 先按用户名取「所有」同名账号（含未激活），按门户角色优先级选其一。
    // 关键：必须先校验密码，密码正确后才判断是否待审核——否则「错密码+存在未激活用户名」与
    // 「错密码+用户名不存在」响应不同，会构成用户名枚举。passwordHash 仅在此函数内使用，不外泄。
    const candidates = await this.prisma.user.findMany({
      where: { username: dto.username },
      select: { id: true, username: true, role: true, isActive: true, passwordHash: true },
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

  /** 通知管理员（leader/admin）有新注册待审核 */
  private async notifyAdminsPendingRegistration(name: string, company: string, department: string, roleLabel: string) {
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
            link: '/settings/users',
          },
        });
      }
    } catch { /* 通知失败不阻塞注册 */ }
  }

  /** 管理员审核：通过注册 */
  async approveUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException({ error: '用户不存在', code: 'NOT_FOUND' });
    if (user.isActive) throw new BadRequestException({ error: '用户已激活', code: 'ALREADY_ACTIVE' });
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    return { ok: true };
  }

  /** 管理员审核：拒绝注册（删除用户） */
  async rejectUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException({ error: '用户不存在', code: 'NOT_FOUND' });
    if (user.isActive) throw new BadRequestException({ error: '用户已激活，无法拒绝', code: 'ALREADY_ACTIVE' });
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
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

  issueToken(sub: string, username: string, role: string) {
    const access_token = this.jwt.sign({ sub, username, role });
    return { access_token, role, username, userId: sub };
  }
}
