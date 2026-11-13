import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AccountAdminController } from './account-admin.controller';
import { PasswordRequestsController } from './password-requests.controller';
import { SupplierPasswordResetController } from './supplier-password-reset.controller';
import { PasswordRequestsService } from './password-requests.service';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { getJwtSecret } from '../common/jwt-secret.helper';
import { VerificationModule } from '../verification/verification.module';
import { NotificationModule } from '../notification/notification.module';
import { ExpertPairingModule } from './expert-pairing.module';

@Module({
  imports: [
    forwardRef(() => NotificationModule),
    ExpertPairingModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
    VerificationModule,
  ],
  controllers: [AuthController, AccountAdminController, PasswordRequestsController, SupplierPasswordResetController],
  providers: [AuthService, AuthGuard, PasswordRequestsService],
  // ExpertPairingModule 须随 JwtModule 一同 re-export：AuthGuard 经 APP_GUARD 在 AppModule
  // scope 实例化（jwt-module-not-dead-in-audit-user-settings 教训——全局守卫的构造依赖只在
  // 其注册模块 scope 解析），配对 registry 不入 exports 则该处解析不到。
  exports: [AuthService, AuthGuard, JwtModule, ExpertPairingModule],
})
export class AuthModule {}
