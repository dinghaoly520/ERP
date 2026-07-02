import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserSettingsService } from './user-settings.service';
import { UserSettingsController } from './user-settings.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'water-erp-jwt-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [UserSettingsController],
  providers: [UserSettingsService],
  exports: [UserSettingsService],
})
export class UserSettingsModule {}
