import { Injectable, NotFoundException } from '@nestjs/common';
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
  web: ['procurement_staff', 'leader', 'staff', 'bid_host', 'admin'],
  expert: ['bid_expert', 'bid_host', 'admin'],
  public: ['procurement_staff', 'leader', 'staff', 'supplier', 'bid_expert', 'bid_host', 'admin', 'mall'],
};

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(dto: RegisterDto) {
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
    const candidates = await this.prisma.user.findMany({
      where: { username: dto.username, isActive: true },
    });
    const user =
      priority.map((role) => candidates.find((u) => u.role === role)).find(Boolean) ??
      candidates[0];
    if (!user || !user.passwordHash || !compareSync(dto.password, user.passwordHash)) {
      return null;
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
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
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
    return { access_token, role, username };
  }
}
