import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, DispatchPayload, ChannelSendResult } from './notification-channel.interface';

@Injectable()
export class PhoneChannel implements NotificationChannel {
  name = 'phone' as const;
  private readonly logger = new Logger(PhoneChannel.name);

  async send(p: DispatchPayload): Promise<ChannelSendResult> {
    // 桩实现：未接入真实电话通知网关（如阿里云语音通知）。当前记录日志便于联调，状态记 skipped。
    this.logger.log(`[PHONE-桩] → ${p.phone}: ${p.title}`);
    return { status: 'skipped', error: '电话通知网关未配置' };
  }
}
