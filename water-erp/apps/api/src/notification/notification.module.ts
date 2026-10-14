import { Module, forwardRef } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PhoneChannel } from './channels/phone.channel';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [forwardRef(() => AuthModule), PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService, EmailChannel, SmsChannel, PhoneChannel, NotificationGateway],
  // NotificationGateway 导出（2026-10-14）：AuthService.rotatePortalSession 注入 evictUser，
  // 会话轮换时驱逐旧 WS 订阅（与 AuthModule 双向 forwardRef 已在）
  exports: [NotificationService, NotificationGateway],
})
export class NotificationModule {}