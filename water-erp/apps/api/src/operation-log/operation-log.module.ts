import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/jwt-secret.helper';
import { OperationLogService } from './operation-log.service';
import { OperationLogController } from './operation-log.controller';
import { OperationLogInterceptor } from './operation-log.interceptor';

@Global()
@Module({
  // controller 受全局 AuthGuard 守卫，AuthGuard 注入 JwtService（与 audit.module 同理）。
  imports: [JwtModule.register({ secret: getJwtSecret(), signOptions: { expiresIn: '7d' } })],
  controllers: [OperationLogController],
  providers: [OperationLogService, { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor }],
  exports: [OperationLogService],
})
export class OperationLogModule {}
