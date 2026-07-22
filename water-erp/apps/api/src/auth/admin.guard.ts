import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { tokenFromRequest } from './portal-cookie';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = tokenFromRequest(req);
    if (!token) throw new ForbiddenException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload.role !== 'admin') throw new ForbiddenException();
      // P2：复查 isActive——被停用管理员的 JWT 在到期前即失效（对齐 AuthGuard 的纵深防御）
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } });
      if (!user || !user.isActive) throw new ForbiddenException();
      (req as any).user = payload;
    } catch (e) {
      throw e instanceof ForbiddenException ? e : new ForbiddenException();
    }
    return true;
  }
}
