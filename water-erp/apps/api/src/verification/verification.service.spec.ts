import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from '../../src/verification/verification.service';

describe('VerificationService', () => {
  let service: VerificationService;
  let redisMock: any;

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
      eval: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: 'REDIS_CLIENT', useValue: redisMock },
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

  describe('registration upload code', () => {
    it('validates the registration code without consuming it before the final registration', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ code: '123456', phone: '13800138000', attempts: 0 }));

      await expect(service.assertRegistrationCodeForUpload('13800138000', '123456'))
        .resolves.toEqual({ ok: true });
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('最终注册以原子 compare-and-delete 消费验证码，并发请求只能成功一次', async () => {
      const record = JSON.stringify({ code: '123456', phone: '13800138000', attempts: 0 });
      redisMock.get.mockResolvedValue(record);
      redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const results = await Promise.allSettled([
        service.verifyRegistrationCode('13800138000', '123456'),
        service.verifyRegistrationCode('13800138000', '123456'),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(redisMock.eval).toHaveBeenCalledTimes(2);
      expect(redisMock.del).not.toHaveBeenCalled();
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { response: { code: 'CODE_EXPIRED' } },
      });
    });
  });
});

describe('VerificationService P1-13 — SMS 真实通道与失败回滚', () => {
  let svc: any;
  let redis: any;

  beforeEach(async () => {
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
