import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { tokenFromRequest } from './portal-cookie';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = tokenFromRequest(req);
    if (!token) throw new ForbiddenException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload.role !== 'admin') throw new ForbiddenException();
      (req as any).user = payload;
    } catch (e) {
      throw e instanceof ForbiddenException ? e : new ForbiddenException();
    }
    return true;
  }
}
