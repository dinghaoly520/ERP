import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, DispatchPayload } from './notification-channel.interface';

@Injectable()
export class EmailChannel implements NotificationChannel {
  name = 'email' as const;
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: any = null;

  constructor() {
    // 延迟加载 nodemailer；未配置 SMTP 时 transporter 为 null，send 降级为 log
    const host = process.env.SMTP_HOST;
    if (host) {
      import('nodemailer')
        .then(({ createTransport }) => {
          this.transporter = createTransport({
            host,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
          });
        })
        .catch(() => {
          this.logger.warn('nodemailer 加载失败，Email 渠道降级为日志');
        });
    }
  }

  async send(p: DispatchPayload): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[Email-降级] → ${p.email}: ${p.title}`);
      return;
    }
    try {
      await this.transporter.sendMail({ to: p.email!, subject: p.title, text: p.content });
    } catch (e) {
      this.logger.warn(`Email 发送失败: ${(e as Error).message}`);
    }
  }
}
