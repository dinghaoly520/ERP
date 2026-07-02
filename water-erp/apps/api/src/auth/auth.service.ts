import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * 登录时按来源门户（X-Portal）优先匹配的 role 顺序。
 * username 不再全局唯一（改为 [username, role] 复合唯一），允许跨 role 同名，
 * 例如「陈主任」可同时是商城/采购/开标三个账号 —— 登录时靠来源门户区分。
 */
const PORTAL_ROLE_PRIORITY: Record<string, string[]> = {
  mall: ['mall'],
  supplier: ['supplier'],
  web: ['procurement_staff', 'bid_host', 'admin'],
  expert: ['bid_expert', 'bid_host', 'admin'],
  public: ['procurement_staff', 'supplier', 'bid_expert', 'bid_host', 'admin', 'mall'],
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
      select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true },
    });
  }

  private issueToken(sub: string, username: string, role: string) {
    const access_token = this.jwt.sign({ sub, username, role });
    return { access_token, role, username };
  }
}
