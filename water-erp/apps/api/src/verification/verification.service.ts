import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomInt } from 'node:crypto';
import { SmsProvider, resolveSmsProvider } from './sms-provider';

interface VerificationRecord {
  code: string;
  phone: string;
  attempts: number;
}

const CODE_LENGTH = 6;
const CODE_TTL = 300;            // 5 minutes
const COOLDOWN_TTL = 60;         // 60 seconds
const MAX_ATTEMPTS = 5;
const IP_RATE_LIMIT = 10;        // per minute

// Dev bypass: set SMS_DEBUG_BYPASS=true to accept "123456" for any verification
const DEBUG_BYPASS_CODE = '123456';
const COMPARE_AND_DELETE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class VerificationService {
  private readonly logger: Logger = new Logger(VerificationService.name);
  private readonly sms: SmsProvider;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.sms = resolveSmsProvider();
  }

  private ipKey(ip: string) {
    return `verification:ip:${ip}`;
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) return phone;
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  }

  private generateCode(): string {
    const digits: number[] = [];
    for (let i = 0; i < CODE_LENGTH; i++) {
      digits.push(randomInt(0, 10)); // 密码学安全随机（Math.random 为 xorshift128+，可预测）
    }
    return digits.join('');
  }

  // ── 注册场景：手机号验证（无需登录，用于 /auth/register 前的号码验证）──

  private regCodeKey(phone: string) {
    return `verification:registration:${phone}`;
  }

  private regCooldownKey(phone: string) {
    return `verification:cooldown:registration:${phone}`;
  }

  async sendRegistrationCode(
    phone: string,
    clientIp: string,
    scene: 'supplier_registration' | 'management_registration' | 'management_password_reset' | 'supplier_password_reset' = 'supplier_registration',
  ) {
    // IP rate limit
    const ipCount = await this.redis.incr(this.ipKey(clientIp));
    if (ipCount === 1) await this.redis.expire(this.ipKey(clientIp), 60);
    if (ipCount > IP_RATE_LIMIT) {
      throw new BadRequestException({ code: 'IP_RATE_LIMITED', error: '请求过于频繁，请稍后再试' });
    }

    // Cooldown
    const cooldown = await this.redis.get(this.regCooldownKey(phone));
    if (cooldown) {
      const ttl = await this.redis.ttl(this.regCooldownKey(phone));
      throw new BadRequestException({ code: 'TOO_FREQUENT', error: `请${ttl}秒后再试` });
    }

    const code = this.generateCode();
    const record: VerificationRecord = { code, phone, attempts: 0 };
    await this.redis.set(this.regCodeKey(phone), JSON.stringify(record), 'EX', CODE_TTL);
    await this.redis.set(this.regCooldownKey(phone), '1', 'EX', COOLDOWN_TTL);

    // P1-13：真实发送通道（provider 失败回滚 Redis 记录，不再静默死链）
    try {
      await this.sms.send(phone, code, scene);
    } catch (err) {
      try { await this.redis.del(this.regCodeKey(phone)); } catch { /* 回滚尽力而为 */ }
      this.logger.error(`SMS 发送失败（scene=supplier_registration）：${(err as Error).message}`);
      throw new BadRequestException({
        code: 'SMS_PROVIDER_FAILED',
        error: '验证码发送失败，请稍后重试或联系管理员',
      });
    }

    return { maskedPhone: this.maskPhone(phone) };
  }

  private async validateRegistrationCode(phone: string, code: string, consume: boolean) {
    if (process.env.SMS_DEBUG_BYPASS === 'true' && code === DEBUG_BYPASS_CODE) {
      if (process.env.NODE_ENV === 'production') {
        throw new BadRequestException({ code: 'BYPASS_FORBIDDEN_IN_PRODUCTION', error: 'SMS_DEBUG_BYPASS 不可在生产环境使用' });
      }
      if (consume) await this.redis.del(this.regCodeKey(phone));
      return { ok: true };
    }

    const raw = await this.redis.get(this.regCodeKey(phone));
    if (!raw) {
      throw new BadRequestException({ code: 'CODE_EXPIRED', error: '验证码已过期，请重新获取' });
    }

    const record: VerificationRecord = JSON.parse(raw);

    if (record.code !== code) {
      record.attempts += 1;
      const remaining = MAX_ATTEMPTS - record.attempts;
      const ttl = await this.redis.ttl(this.regCodeKey(phone));
      await this.redis.set(this.regCodeKey(phone), JSON.stringify(record), 'EX', ttl > 0 ? ttl : CODE_TTL);
      if (remaining <= 0) {
        await this.redis.del(this.regCodeKey(phone));
        throw new BadRequestException({ code: 'ATTEMPTS_EXCEEDED', error: '尝试次数过多，请重新获取验证码' });
      }
      throw new BadRequestException({ code: 'CODE_INVALID', error: `验证码错误，剩余 ${remaining} 次尝试` });
    }

    if (consume) {
      const consumed = await this.redis.eval(
        COMPARE_AND_DELETE_SCRIPT,
        1,
        this.regCodeKey(phone),
        raw,
      );
      if (Number(consumed) !== 1) {
        throw new BadRequestException({
          code: 'CODE_EXPIRED',
          error: '验证码已使用或已过期，请重新获取',
        });
      }
    }
    return { ok: true };
  }

  /** 注册附件上传只校验、不消费验证码；最终注册仍须再次校验并一次性消费。 */
  assertRegistrationCodeForUpload(phone: string, code: string) {
    return this.validateRegistrationCode(phone, code, false);
  }

  verifyRegistrationCode(phone: string, code: string) {
    return this.validateRegistrationCode(phone, code, true);
  }

  /** 注册验证码预检（不消费）：前端输满 6 位即时反馈 ✓/✗ 用；沿用 attempts≤5 防爆破。 */
  checkRegistrationCode(phone: string, code: string) {
    return this.validateRegistrationCode(phone, code, false);
  }
}
