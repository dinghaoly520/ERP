import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VerificationService } from '../../src/verification/verification.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('VerificationService', () => {
  let service: VerificationService;
  let redisMock: any;
  let prismaMock: any;

  const OLD_DEBUG = process.env.SMS_DEBUG_BYPASS;

  beforeEach(async () => {
    // Disable debug bypass so unit tests exercise real code paths
    delete process.env.SMS_DEBUG_BYPASS;
    // P1-13：单测环境默认 console provider（非生产合法；不触发真实 HTTP）
    process.env.SMS_PROVIDER = 'console';

    redisMock = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
    };

    prismaMock = {
      bidExpert: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: 'REDIS_CLIENT', useValue: redisMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  afterEach(() => {
    // Restore debug bypass
    if (OLD_DEBUG !== undefined) {
      process.env.SMS_DEBUG_BYPASS = OLD_DEBUG;
    }
    delete process.env.SMS_PROVIDER;
  });

  describe('verifyCode', () => {
    it('should throw CODE_EXPIRED when no code in Redis', async () => {
      redisMock.get.mockResolvedValue(null);

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw CODE_INVALID when code does not match', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '999999', phone: '138****5678', attempts: 0 }));
      redisMock.ttl.mockResolvedValue(300);
      redisMock.set.mockResolvedValue('OK');

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return ok when code matches', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '123456', phone: '13800000001', attempts: 0 }));
      redisMock.del.mockResolvedValue(1);
      prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'expert1' });
      prismaMock.bidExpert.update.mockResolvedValue({});

      const result = await service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456');
      expect(result.ok).toBe(true);
    });

    it('should throw ATTEMPTS_EXCEEDED after 5 failed attempts', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '999999', phone: '13800000001', attempts: 5 }));

      await expect(
        service.verifyCode('expert_sign_in', 'user1', 'proj1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendCode', () => {
    it('should throw when cooldown is active', async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);
      redisMock.get.mockResolvedValue('1');  // cooldown active
      redisMock.ttl.mockResolvedValue(45);

      await expect(
        service.sendCode('expert_sign_in', 'user1', 'proj1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should succeed when expert has phone', async () => {
      redisMock.incr.mockResolvedValue(1);
      redisMock.expire.mockResolvedValue(1);
      redisMock.get.mockResolvedValue(null);  // no cooldown
      redisMock.set.mockResolvedValue('OK');
      prismaMock.bidExpert.findFirst.mockResolvedValue({
        user: { expertProfile: { phone: '13800000001' } },
      });

      const result = await service.sendCode('expert_sign_in', 'user1', 'proj1', '127.0.0.1');
      expect(result.maskedPhone).toBe('138****0001');
    });
  });
});

describe('VerificationService P1-13 — SMS 真实通道与失败回滚', () => {
  let svc: any;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    prisma = { user: { findFirst: jest.fn() } };
    redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    const { VerificationService } = await import('./verification.service');
    const { resolveSmsProvider } = await import('./sms-provider');
    const instance: any = Object.create(VerificationService.prototype);
    instance.redis = redis;
    instance.prisma = prisma;
    instance.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    instance.sms = resolveSmsProvider(); // 每个 it 按当轮 env 重新解析 provider
    svc = instance;
  });
  afterEach(() => {
    delete process.env.SMS_HTTP_ENDPOINT;
    delete process.env.SMS_PROVIDER;
  });

  it('sendRegistrationCode：provider 发送失败 → 删除 Redis 记录 + 400 SMS_PROVIDER_FAILED（不再静默死链）', async () => {
    process.env.SMS_PROVIDER = 'http';
    process.env.SMS_HTTP_ENDPOINT = 'http://sms-gateway.invalid/send';
    (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('network unreachable'));

    await expect(svc.sendRegistrationCode('13800138000', '127.0.0.1'))
      .rejects.toMatchObject({ response: { code: 'SMS_PROVIDER_FAILED' } });
    expect(redis.del).toHaveBeenCalled(); // 回滚验证码记录
    expect((svc as any).logger.error).toHaveBeenCalled();
  });

  it('sendRegistrationCode：HTTP 网关返回非 200 → 同码失败 + 回滚', async () => {
    process.env.SMS_PROVIDER = 'http';
    process.env.SMS_HTTP_ENDPOINT = 'http://sms-gateway.local/send';
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(svc.sendRegistrationCode('13800138000', '127.0.0.1'))
      .rejects.toMatchObject({ response: { code: 'SMS_PROVIDER_FAILED' } });
    expect(redis.del).toHaveBeenCalled();
  });

  it('sendRegistrationCode：Console provider（非生产）→ 成功（debug 兼容路径）', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.SMS_PROVIDER = 'console';
    delete process.env.NODE_ENV; // ConsoleSmsProvider 生产守卫——临时确认为非生产
    const { resolveSmsProvider } = await import('./sms-provider');
    (svc as any).sms = resolveSmsProvider(); // env 变更后重解析（beforeEach 时还是默认 http）
    try {
      const res = await svc.sendRegistrationCode('13800138000', '127.0.0.1');
      expect(res.maskedPhone).toBe('138****8000');
      expect(redis.set).toHaveBeenCalled(); // 验证码记录保留
    } finally {
      process.env.NODE_ENV = prevEnv || 'test';
    }
  });
});
