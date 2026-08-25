import { Injectable, Logger } from '@nestjs/common';

/** P1-13：SMS 验证码发送通道抽象——真实网关（泛型 HTTP）与本地控制台（仅非生产 debug）可替换。 */
export interface SmsProvider {
  readonly id: string;
  /** 发送验证码短信；返回网关请求标识（无则 undefined）。失败抛错（调用方决定是否回滚 Redis 记录）。 */
  send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined>;
}

/** 生产形态：泛型 HTTP 网关（阿里云/腾讯云等网关模式通用）。env：
 * SMS_HTTP_ENDPOINT（必填，POST JSON）、SMS_HTTP_API_KEY、SMS_HTTP_TEMPLATE_ID、SMS_HTTP_FROM_SIGN、
 * 请求体 { phone, code, scene, templateId, fromSign, apiKey }（网关侧适配模板）。 */
@Injectable()
export class HttpSmsProvider implements SmsProvider {
  readonly id = 'http';
  private readonly logger = new Logger(HttpSmsProvider.name);

  async send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined> {
    const endpoint = process.env.SMS_HTTP_ENDPOINT;
    if (!endpoint) {
      throw new Error('SMS_HTTP_ENDPOINT 未配置');
    }
    const body = {
      phone,
      code,
      scene,
      templateId: process.env.SMS_HTTP_TEMPLATE_ID ?? '',
      fromSign: process.env.SMS_HTTP_FROM_SIGN ?? '',
      apiKey: process.env.SMS_HTTP_API_KEY ?? '',
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`SMS 网关响应异常：HTTP ${res.status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { requestId?: string };
    this.logger.log(`SMS 已发送：${scene} → ${this.mask(phone)}${data.requestId ? `（${data.requestId}）` : ''}`);
    return data.requestId ? { requestId: data.requestId } : undefined;
  }

  private mask(phone: string): string {
    return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***';
  }
}

/** 本地控制台实现：仅非生产 + SMS_DEBUG_BYPASS=true 可用（把原 console.log stub 收进 provider）。 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly id = 'console';
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(phone: string, code: string, scene: string): Promise<{ requestId?: string } | undefined> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ConsoleSmsProvider 不可在生产环境使用');
    }
    this.logger.warn(`[SMS-STUB] 验证码: ${code} → ${phone}（场景: ${scene}）`);
    return undefined;
  }
}

/** 按 env SMS_PROVIDER 解析 provider：'http'（默认）→ HttpSmsProvider；'console' → ConsoleSmsProvider（仅非生产）。 */
export function resolveSmsProvider(): SmsProvider {
  const mode = (process.env.SMS_PROVIDER ?? 'http').toLowerCase();
  if (mode === 'console') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMS_PROVIDER=console 不可在生产环境使用');
    }
    return new ConsoleSmsProvider();
  }
  if (mode === 'http') {
    return new HttpSmsProvider();
  }
  throw new Error(`未知 SMS_PROVIDER: ${mode}`);
}
