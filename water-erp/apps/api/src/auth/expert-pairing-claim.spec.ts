import { JwtService } from '@nestjs/jwt';
import { hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';
import { ExpertService } from '../expert/expert.service';
import { getJwtSecret } from '../common/jwt-secret.helper';

/**
 * TAB-SYNC-01 Task 5：claim 配对语义（不轮换会话）+ 配对查询/解绑。
 *
 * 核心反目标（spec §5.1/§11）：claim 成功【绝不】写 User.webSessionId / 不调
 * rotatePortalSession——桌面会话不受影响；平板侧改走 registry.register + 受限 JWT
 * （scope=tablet-pairing，显式 expiresIn 12h）。
 *
 * 迁移票机制全保留（spec §8.1）：票据单次 + 并发互斥锁、密码 3 次烧票、票据绑定
 * 签发时桌面 sid（TICKET_STALE）、临时账号复核、留档照 pending。
 */

const PASSWORD = 'pair-pass-1';
const TICKET_KEY = 'expert-transfer:tick-1';

/** 签发时写入的票据载荷（issuePairingTicket 产物，键名沿用迁移票 internal 键） */
const TICKET_PAYLOAD = {
  userId: 'u1',
  expertId: 'e1',
  expertName: '杨睿',
  projectId: 'p1',
  sid: 'desk-sid-1',
  ticketId: 'tid-1',
};

const TABLET_UA =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

/** ioredis 最小桩：覆盖 claim 路径用到的 get/set(EX,NX)/del/incr/expire */
class FakeRedis {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
  async incr(key: string): Promise<number> {
    const v = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(v));
    return v;
  }
  async expire(): Promise<number> {
    return 1;
  }
}

describe('AuthService.claimExpertPairing（Task 5 配对语义）', () => {
  const jwt = new JwtService({ secret: getJwtSecret() });

  const makeService = (opts: {
    redis?: FakeRedis;
    webSessionId?: string;
    signInMeta?: unknown;
    pairingId?: string;
  } = {}) => {
    const redis = opts.redis ?? new FakeRedis();
    redis.store.set(TICKET_KEY, JSON.stringify(TICKET_PAYLOAD));
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          username: '杨睿',
          role: 'bid_expert',
          isActive: true,
          isFrozen: false,
          isTempExpert: false,
          passwordHash: hashSync(PASSWORD, 4),
          webSessionId: opts.webSessionId ?? 'desk-sid-1',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      bidExpert: {
        findFirst: jest.fn().mockResolvedValue({ id: 'e1', signInMeta: opts.signInMeta ?? null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const registry = {
      register: jest.fn().mockResolvedValue({ pairingId: opts.pairingId ?? 'jti-new-1', replaced: null }),
      revoke: jest.fn(),
      getActive: jest.fn(),
      isAlive: jest.fn(),
      revokeForUser: jest.fn(),
    };
    const svc = new AuthService(
      prisma as any,
      jwt as any,
      {} as any,
      redis as any,
      undefined,
      undefined,
      undefined,
      registry as any,
    );
    return { svc, prisma, redis, registry };
  };

  it('①成功：不动 webSessionId、登记配对、签 12h 受限令牌（claims 全字段）', async () => {
    const { svc, prisma, redis, registry } = makeService();

    const result = await svc.claimExpertPairing(
      { ticket: 'tick-1', password: PASSWORD },
      { ip: '10.1.2.3', userAgent: TABLET_UA },
    );

    // 反目标（底线）：桌面会话不受影响——不轮换、不写 webSessionId/sessionMeta
    expect(prisma.user.update).not.toHaveBeenCalled();
    // 登记配对：expertId 取当前 BidExpert 行，device 为 IP/UA 摘要投影
    expect(registry.register).toHaveBeenCalledWith({
      userId: 'u1',
      expertId: 'e1',
      projectId: 'p1',
      device: { uaSummary: 'Safari·iPadOS', ip: '10.1.2.3' },
    });
    // 受限令牌：同一 JWT_SECRET 可验签；claims 与 TTL 逐字段断言
    const claims = jwt.decode(result.access_token) as Record<string, unknown> & { iat: number; exp: number };
    expect(jwt.verify(result.access_token)).toBeTruthy();
    expect(claims).toMatchObject({
      sub: 'u1',
      username: '杨睿',
      role: 'bid_expert',
      sid: 'desk-sid-1',
      scope: 'tablet-pairing',
      pid: 'p1',
      eid: 'e1',
      jti: 'jti-new-1',
    });
    expect(claims.exp - claims.iat).toBe(12 * 3600); // 显式 12h（模块默认 7d 不得生效）
    // 返回形状与旧 claim 一致（pair 页改动最小化）；签到无照 → photoRequired
    expect(result).toMatchObject({
      role: 'bid_expert',
      username: '杨睿',
      projectId: 'p1',
      photoRequired: true,
    });
    // 票据单次使用：销毁；状态键 pending → paired（桌面 QR 弹窗轮询口径）
    expect(redis.store.has(TICKET_KEY)).toBe(false);
    expect(JSON.parse(redis.store.get('expert-transfer-status:tid-1')!)).toMatchObject({ status: 'paired' });
    // 留档照 pending 落库（签到无照者配对后强制补拍）
    expect(prisma.bidExpert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', userId: 'u1' },
        data: expect.objectContaining({ transferPhotoPendingAt: expect.any(Date) }),
      }),
    );
    // 监督日志：平板配对成功，含设备摘要与「桌面会话不受影响」
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1',
          target: '杨睿',
          action: '平板配对成功',
          riskFlag: '无',
          result: expect.stringContaining('桌面会话不受影响'),
        }),
      }),
    );
  });

  it('②密码连错 3 次 → 烧票 TICKET_BURNED，票据删除、不登记配对', async () => {
    const { svc, redis, registry } = makeService();

    await expect(
      svc.claimExpertPairing({ ticket: 'tick-1', password: 'wrong' }, {}),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_MISMATCH' } });
    await expect(
      svc.claimExpertPairing({ ticket: 'tick-1', password: 'wrong' }, {}),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_MISMATCH' } });
    // 第 3 次：烧票（票据作废 + 删键），此后持票者无再试机会
    await expect(
      svc.claimExpertPairing({ ticket: 'tick-1', password: 'wrong' }, {}),
    ).rejects.toMatchObject({ response: { code: 'TICKET_BURNED' } });

    expect(redis.store.has(TICKET_KEY)).toBe(false);
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('③票据 sid ≠ 当前桌面 webSessionId → 409 TICKET_STALE（防旧票复用）', async () => {
    const { svc, redis, registry } = makeService({ webSessionId: 'desk-sid-rotated' });

    await expect(
      svc.claimExpertPairing({ ticket: 'tick-1', password: PASSWORD }, {}),
    ).rejects.toMatchObject({ response: { code: 'TICKET_STALE' } });

    expect(redis.store.has(TICKET_KEY)).toBe(false);
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('④并发领取（票据互斥锁被占）→ 409 CLAIM_IN_PROGRESS，票据不销毁', async () => {
    const redis = new FakeRedis();
    redis.store.set('expert-transfer-lock:tid-1', '1'); // 他人持有锁
    const { svc, registry } = makeService({ redis });

    await expect(
      svc.claimExpertPairing({ ticket: 'tick-1', password: PASSWORD }, {}),
    ).rejects.toMatchObject({ response: { code: 'CLAIM_IN_PROGRESS' } });

    expect(registry.register).not.toHaveBeenCalled();
    // 未获锁即返回：票据仍在（由持锁方裁决单次语义）
    expect(redis.store.has(TICKET_KEY)).toBe(true);
  });
});

describe('ExpertService.getPairing / unpair（Task 5 查询与解绑）', () => {
  /** 直构（expert.service.spec 同款 Object.create 模式，绕开构造参数） */
  const makeService = (expertRow: unknown, registry: unknown) => {
    const supervisionCreate = jest.fn().mockResolvedValue({});
    const svc: any = Object.create(ExpertService.prototype);
    svc.prisma = {
      bidExpert: { findFirst: jest.fn().mockResolvedValue(expertRow) },
      bidSupervisionLog: { create: supervisionCreate },
    };
    svc.pairingRegistry = registry;
    return { svc, supervisionCreate };
  };

  const EXPERT_ROW = { id: 'e1', expertName: '杨睿' };

  it('⑤非本项目专家：getPairing / unpair 均 403 NOT_PROJECT_EXPERT', async () => {
    const { svc: pairSvc } = makeService(null, {});
    await expect(pairSvc.getPairing('u-other', 'p1')).rejects.toMatchObject({
      response: { code: 'NOT_PROJECT_EXPERT' },
    });

    const { svc: unpairSvc } = makeService(null, {});
    await expect(unpairSvc.unpair('u-other', 'p1')).rejects.toMatchObject({
      response: { code: 'NOT_PROJECT_EXPERT' },
    });
  });

  it('getPairing：活动配对 → 投影 device/pairedAt；无配对 → { device:null, pairedAt:null }', async () => {
    const active = { getActive: jest.fn().mockResolvedValue(null) };
    const { svc } = makeService(EXPERT_ROW, active);
    await expect(svc.getPairing('u1', 'p1')).resolves.toEqual({ device: null, pairedAt: null });
    expect(active.getActive).toHaveBeenCalledWith('e1', 'p1');

    const paired = {
      getActive: jest.fn().mockResolvedValue({
        pairingId: 'jti-1',
        device: { uaSummary: 'Safari·iPadOS', ip: '10.1.2.3' },
        pairedAt: 1731400000000,
      }),
    };
    const { svc: svc2 } = makeService(EXPERT_ROW, paired);
    await expect(svc2.getPairing('u1', 'p1')).resolves.toEqual({
      device: { uaSummary: 'Safari·iPadOS', ip: '10.1.2.3' },
      pairedAt: 1731400000000,
    });
  });

  it('unpair：活动配对 → revoke + 监督日志「平板解除配对」；无配对 → 幂等 ok 不写日志', async () => {
    const registry = {
      getActive: jest.fn().mockResolvedValue({ pairingId: 'jti-1', device: null, pairedAt: 1 }),
      revoke: jest.fn().mockResolvedValue({ userId: 'u1', expertId: 'e1', projectId: 'p1' }),
    };
    const { svc, supervisionCreate } = makeService(EXPERT_ROW, registry);
    await expect(svc.unpair('u1', 'p1')).resolves.toEqual({ ok: true });
    expect(registry.revoke).toHaveBeenCalledWith('jti-1');
    expect(supervisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1',
          target: '杨睿',
          action: '平板解除配对',
          result: '桌面端主动解除配对',
          riskFlag: '无',
        }),
      }),
    );

    // 无活动配对：幂等成功，不调 revoke、不写监督日志
    const idle = { getActive: jest.fn().mockResolvedValue(null), revoke: jest.fn() };
    const { svc: svc2, supervisionCreate: log2 } = makeService(EXPERT_ROW, idle);
    await expect(svc2.unpair('u1', 'p1')).resolves.toEqual({ ok: true });
    expect(idle.revoke).not.toHaveBeenCalled();
    expect(log2).not.toHaveBeenCalled();
  });
});
