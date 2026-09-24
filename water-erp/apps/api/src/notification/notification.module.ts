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
  exports: [NotificationService],
})
export class NotificationModule {}