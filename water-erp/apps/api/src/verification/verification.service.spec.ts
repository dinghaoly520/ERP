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

    // ── 注册会话 token（2026-10-09）：六步向导验证一次后凭 token 走完全程 ──

    it('verifyAndStartRegistrationSession：消费验证码并签发 30 分钟会话（Redis 两键，sha256(token) 为键）', async () => {
      const record = JSON.stringify({ code: '123456', phone: '13800138000', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(record); // validate 读取
      redisMock.eval.mockResolvedValueOnce(1); // compare-and-delete 消费成功
      redisMock.get.mockResolvedValueOnce(null); // by-phone 指针不存在（无旧会话）

      const res = await service.verifyAndStartRegistrationSession('13800138000', '123456');

      expect(res.ok).toBe(true);
      expect(res.token).toMatch(/^[0-9a-f]{64}$/); // randomBytes(32).hex
      expect(res.expiresIn).toBe(1800);
      // 会话键 sha256(token) → { phone }，EX 1800
      const sessionSet = redisMock.set.mock.calls.find((c: string[]) =>
        c[0].startsWith('verification:registration:session:') && !c[0].includes('by-phone'));
      expect(sessionSet).toBeTruthy();
      expect(sessionSet![2]).toBe('EX');
      expect(sessionSet![3]).toBe(1800);
      expect(JSON.parse(sessionSet![1] as string)).toEqual({ phone: '13800138000' });
      // by-phone 指针键 → sha256(token)
      const pointerSet = redisMock.set.mock.calls.find((c: string[]) => c[0].includes('by-phone'));
      expect(pointerSet).toBeTruthy();
      expect(String(pointerSet![1])).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifyAndStartRegistrationSession：同手机号重验 → 旧 token 会话键被删除（单活会话）', async () => {
      const record = JSON.stringify({ code: '654321', phone: '13800138000', attempts: 0 });
      redisMock.get.mockResolvedValueOnce(record);
      redisMock.eval.mockResolvedValueOnce(1);
      redisMock.get.mockResolvedValueOnce('old-token-hash'); // by-phone 指针存在

      await service.verifyAndStartRegistrationSession('13800138000', '654321');

      expect(redisMock.del).toHaveBeenCalledWith('verification:registration:session:old-token-hash');
    });

    it('assertRegistrationSession：有效 → 返回绑定手机号并滑动续期（两键）', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ phone: '13800138000' }));

      const res = await service.assertRegistrationSession('a'.repeat(64));

      expect(res).toEqual({ phone: '13800138000' });
      expect(redisMock.expire).toHaveBeenCalledTimes(2);
    });

    it('assertRegistrationSession：无效/过期 → 400 REGISTRATION_SESSION_EXPIRED', async () => {
      redisMock.get.mockResolvedValue(null);

      await expect(service.assertRegistrationSession('b'.repeat(64)))
        .rejects.toMatchObject({ response: { code: 'REGISTRATION_SESSION_EXPIRED' } });
    });

    it('consumeRegistrationSession：消费即删两键；二次消费 → 400', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify({ phone: '13800138000' }));

      await service.consumeRegistrationSession('c'.repeat(64));

      expect(redisMock.del).toHaveBeenCalledTimes(2); // 会话键 + by-phone 指针
      redisMock.get.mockResolvedValue(null);
      await expect(service.consumeRegistrationSession('c'.repeat(64)))
        .rejects.toMatchObject({ response: { code: 'REGISTRATION_SESSION_EXPIRED' } });
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
