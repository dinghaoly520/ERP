import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationScene } from './dto/send-code.dto';
import { randomInt } from 'node:crypto';

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

@Injectable()
export class VerificationService {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private codeKey(scene: string, userId: string, targetId: string) {
    return `verification:${scene}:${userId}:${targetId}`;
  }

  private cooldownKey(scene: string, userId: string, targetId: string) {
    return `verification:cooldown:${scene}:${userId}:${targetId}`;
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

  private async getPhoneForExpertSignIn(
    userId: string,
    projectId: string,
  ): Promise<string> {
    // Verify user is assigned as an expert to this project
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
      include: {
        user: { include: { expertProfile: true } },
      },
    });

    if (!expert) {
      throw new BadRequestException({
        code: 'NOT_EXPERT',
        error: '您不是该项目的评审专家',
      });
    }

    const phone = expert.user?.expertProfile?.phone;
    if (!phone) {
      throw new BadRequestException({
        code: 'PHONE_NOT_FOUND',
        error: '未绑定手机号，请联系管理员完善资料',
      });
    }

    return phone;
  }

  async sendCode(
    scene: VerificationScene,
    userId: string,
    targetId: string,
    clientIp: string,
  ) {
    // IP rate limit check
    const ipCount = await this.redis.incr(this.ipKey(clientIp));
    if (ipCount === 1) {
      await this.redis.expire(this.ipKey(clientIp), 60);
    }
    if (ipCount > IP_RATE_LIMIT) {
      throw new BadRequestException({
        code: 'IP_RATE_LIMITED',
        error: '请求过于频繁，请稍后再试',
      });
    }

    // Cooldown check
    const cooldown = await this.redis.get(
      this.cooldownKey(scene, userId, targetId),
    );
    if (cooldown) {
      const ttl = await this.redis.ttl(this.cooldownKey(scene, userId, targetId));
      throw new BadRequestException({
        code: 'TOO_FREQUENT',
        error: `请${ttl}秒后再试`,
      });
    }

    // Get phone number (scene-specific logic)
    let phone: string;
    switch (scene) {
      case 'expert_sign_in':
        phone = await this.getPhoneForExpertSignIn(userId, targetId);
        break;
      default:
        throw new BadRequestException({
          code: 'UNSUPPORTED_SCENE',
          error: `不支持的验证场景: ${scene}`,
        });
    }

    // Generate code and store in Redis
    const code = this.generateCode();
    const record: VerificationRecord = { code, phone, attempts: 0 };
    const key = this.codeKey(scene, userId, targetId);
    await this.redis.set(key, JSON.stringify(record), 'EX', CODE_TTL);

    // Set cooldown
    await this.redis.set(
      this.cooldownKey(scene, userId, targetId),
      '1',
      'EX',
      COOLDOWN_TTL,
    );

    // 仅在 dev stub 模式下打印验证码（生产用真 SMS 时不应把验证码写进日志）
    if (process.env.SMS_DEBUG_BYPASS === 'true') {
      console.log(`[SMS-STUB] 验证码: ${code} → ${phone} (场景: ${scene})`);
    }

    return { maskedPhone: this.maskPhone(phone) };
  }

  async verifyCode(
    scene: VerificationScene,
    userId: string,
    targetId: string,
    code: string,
  ) {
    const key = this.codeKey(scene, userId, targetId);

    // Dev bypass
    if (
      process.env.SMS_DEBUG_BYPASS === 'true' &&
      code === DEBUG_BYPASS_CODE
    ) {
      // Mark phoneVerified in BidExpert for the sign-in scene
      if (scene === 'expert_sign_in') {
        await this.markPhoneVerified(userId, targetId);
      }
      return { ok: true };
    }

    const raw = await this.redis.get(key);
    if (!raw) {
      throw new BadRequestException({
        code: 'CODE_EXPIRED',
        error: '验证码已过期，请重新获取',
      });
    }

    const record: VerificationRecord = JSON.parse(raw);

    if (record.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException({
        code: 'ATTEMPTS_EXCEEDED',
        error: '尝试次数过多，请重新获取验证码',
      });
    }

    if (record.code !== code) {
      record.attempts += 1;
      const remaining = MAX_ATTEMPTS - record.attempts;
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(record), 'EX', ttl > 0 ? ttl : CODE_TTL);

      if (remaining <= 0) {
        await this.redis.del(key);
        throw new BadRequestException({
          code: 'ATTEMPTS_EXCEEDED',
          error: '尝试次数过多，请重新获取验证码',
        });
      }

      throw new BadRequestException({
        code: 'CODE_INVALID',
        error: `验证码错误，剩余 ${remaining} 次尝试`,
      });
    }

    // Code correct — delete from Redis, mark phone verified
    await this.redis.del(key);

    if (scene === 'expert_sign_in') {
      await this.markPhoneVerified(userId, targetId);
    }

    return { ok: true };
  }

  private async markPhoneVerified(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { userId, projectId },
    });
    if (expert) {
      await this.prisma.bidExpert.update({
        where: { id: expert.id },
        data: { phoneVerified: true },
      });
    }
  }
}
