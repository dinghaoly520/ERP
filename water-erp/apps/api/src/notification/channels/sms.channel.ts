import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, DispatchPayload, ChannelSendResult } from './notification-channel.interface';

@Injectable()
export class SmsChannel implements NotificationChannel {
  name = 'sms' as const;
  private readonly logger = new Logger(SmsChannel.name);

  async send(p: DispatchPayload): Promise<ChannelSendResult> {
    // 桩实现：未接入真实短信网关（阿里云/腾讯云）。当前记录日志便于联调，状态记 skipped。
    this.logger.log(`[SMS-桩] → ${p.phone}: ${p.title}`);
    return { status: 'skipped', error: 'SMS 网关未配置' };
  }
}
