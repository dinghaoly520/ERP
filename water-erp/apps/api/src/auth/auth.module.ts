import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
    VerificationModule,
  ],
  controllers: [AuthController, AccountAdminController, PasswordRequestsController, SupplierPasswordResetController],
  providers: [AuthService, AuthGuard, PasswordRequestsService],
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}
