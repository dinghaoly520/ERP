import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, DispatchPayload } from './notification-channel.interface';

@Injectable()
export class SmsChannel implements NotificationChannel {
  name = 'sms' as const;
  private readonly logger = new Logger(SmsChannel.name);

  async send(p: DispatchPayload): Promise<void> {
    // 桩实现：待接入真实短信网关（阿里云/腾讯云）。当前记录日志便于联调。
    this.logger.log(`[SMS-桩] → ${p.phone}: ${p.title}`);
  }
}
