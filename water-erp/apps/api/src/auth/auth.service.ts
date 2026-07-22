import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(dto: RegisterDto) {
    // 查重：register 默认创建 role=internal_user，命中 [username, role] 唯一约束会抛 P2002（原返回 500）→ 归一化为 409
    const existing = await this.prisma.user.findFirst({
      where: { username: dto.username, role: 'internal_user' },
    });
    if (existing) {
      throw new ConflictException({ error: '账号已存在', code: 'USERNAME_EXISTS' });
    }
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        displayName: dto.displayName,
        email: dto.email,
        passwordHash: hashSync(dto.password, 10),
      },
    });
    return this.issueToken(user.id, user.username, user.role);
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

  private issueToken(sub: string, username: string, role: string) {
    const access_token = this.jwt.sign({ sub, username, role });
    return { access_token, role, username, userId: sub };
  }
}
