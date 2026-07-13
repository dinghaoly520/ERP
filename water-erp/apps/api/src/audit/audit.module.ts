import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { getJwtSecret } from '../common/jwt-secret.helper';

@Global()
@Module({
  // AuditController 受全局 AuthGuard 守卫，AuthGuard 注入 JwtService，
  // 故本模块需在自身作用域提供 JwtService（与 auth.module 共用同一校验过的密钥）。
  imports: [JwtModule.register({ secret: getJwtSecret(), signOptions: { expiresIn: '7d' } })],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
