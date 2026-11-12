import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { ExpertPairingRegistry } from './expert-pairing.registry';
import { ExpertPairingModule } from './expert-pairing.module';
import { RedisModule } from '../redis/redis.module';

/** Map 内存版 ioredis 子集——只实现 ExpertPairingRegistry 实际调用的面（get/set(EX)/del/scan） */
class FakeRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  /** ioredis: set(key, value, 'EX', seconds) */
  async set(key: string, value: string, ...rest: unknown[]): Promise<'OK'> {
    const exIdx = rest.indexOf('EX');
    if (exIdx >= 0) this.ttls.set(key, Number(rest[exIdx + 1]));
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n += 1;
      this.ttls.delete(k);
    }
    return n;
  }

  /** ioredis: scan(cursor, 'MATCH', pattern, 'COUNT', n) → [nextCursor, keys]。
   *  单批全返（游标恒回 '0'）——只测语义不测分页。 */
  async scan(_cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
    const mIdx = args.indexOf('MATCH');
    const pattern = mIdx >= 0 ? String(args[mIdx + 1]) : '*';
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return ['0', [...this.store.keys()].filter(k => regex.test(k)).sort()];
  }

  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }
}

const DEVICE = { uaSummary: 'iPad · Safari 18', ip: '10.0.0.8' };

describe('ExpertPairingRegistry', () => {
  const make = (fake = new FakeRedis()) => ({
    fake,
    reg: new ExpertPairingRegistry(fake as unknown as Redis),
  });
  const register = (reg: ExpertPairingRegistry, userId = 'u-1', suffix = '1') =>
    reg.register({
      userId,
      expertId: `e-${suffix}`,
      projectId: `p-${suffix}`,
      device: DEVICE,
    });

  describe('register（新建）', () => {
    it('两键落库：entry JSON 契约字段 + active 键指向 pairingId；replaced=null', async () => {
      const { fake, reg } = make();
      const before = Date.now();
      const res = await register(reg);
      expect(res.replaced).toBeNull();
      expect(res.pairingId).toMatch(/^[0-9a-f-]{36}$/); // randomUUID

      const raw = fake.store.get(`expert-pairing:${res.pairingId}`);
      expect(raw).toBeTruthy();
      const entry = JSON.parse(raw!);
      expect(entry).toMatchObject({
        userId: 'u-1',
        expertId: 'e-1',
        projectId: 'p-1',
        device: DEVICE,
      });
      expect(entry.pairedAt).toBeGreaterThanOrEqual(before);
      expect(entry.pairedAt).toBeLessThanOrEqual(Date.now());
      expect(fake.store.get('expert-pairing:active:e-1:p-1')).toBe(res.pairingId);
    });

    it('TTL 传参 12h（两键均 12*3600 秒）', async () => {
      const { fake, reg } = make();
      const res = await register(reg);
      expect(fake.ttlOf(`expert-pairing:${res.pairingId}`)).toBe(12 * 3600);
      expect(fake.ttlOf('expert-pairing:active:e-1:p-1')).toBe(12 * 3600);
    });
  });

  describe('register（单台替换）', () => {
    it('旧 jti 条目被 DEL、active 键改指新 pairingId、replaced=旧 pairingId', async () => {
      const { fake, reg } = make();
      const first = await register(reg, 'u-1', '1');
      const second = await register(reg, 'u-1', '1'); // 同 expert+project 再配一台
      expect(second.replaced).toBe(first.pairingId);
      expect(fake.store.has(`expert-pairing:${first.pairingId}`)).toBe(false);
      expect(fake.store.get('expert-pairing:active:e-1:p-1')).toBe(second.pairingId);
      expect(fake.store.get(`expert-pairing:${second.pairingId}`)).toBeTruthy();
    });

    it('不同 expert/project 的配对互不替换（active 键按 eid:pid 隔离）', async () => {
      const { fake, reg } = make();
      const a = await register(reg, 'u-1', '1');
      const b = await register(reg, 'u-1', '2');
      expect(b.replaced).toBeNull();
      expect(fake.store.get(`expert-pairing:${a.pairingId}`)).toBeTruthy();
    });
  });

  describe('isAlive', () => {
    it('userId 匹配 → true；不匹配 → false；未知 pairingId → false', async () => {
      const { reg } = make();
      const res = await register(reg, 'u-1');
      await expect(reg.isAlive(res.pairingId, 'u-1')).resolves.toBe(true);
      await expect(reg.isAlive(res.pairingId, 'u-other')).resolves.toBe(false);
      await expect(reg.isAlive('00000000-0000-0000-0000-000000000000', 'u-1')).resolves.toBe(false);
    });
  });

  describe('revoke', () => {
    it('返回被删条目 {userId, expertId, projectId} 供监督日志；之后 isAlive false', async () => {
      const { reg } = make();
      const res = await register(reg, 'u-1');
      await expect(reg.revoke(res.pairingId)).resolves.toEqual({
        userId: 'u-1',
        expertId: 'e-1',
        projectId: 'p-1',
      });
      await expect(reg.isAlive(res.pairingId, 'u-1')).resolves.toBe(false);
    });

    it('同步清除指向该配对的 active 反向键（后续 register 不再误报 replaced）', async () => {
      const { fake, reg } = make();
      const res = await register(reg, 'u-1');
      await reg.revoke(res.pairingId);
      expect(fake.store.has('expert-pairing:active:e-1:p-1')).toBe(false);
      const again = await register(reg, 'u-1');
      expect(again.replaced).toBeNull();
    });

    it('active 键已指向新配对时不误删（保护并发替换后的新平板）', async () => {
      const { fake, reg } = make();
      const first = await register(reg, 'u-1');
      const second = await register(reg, 'u-1');
      await reg.revoke(first.pairingId); // 迟到吊销旧配对
      expect(fake.store.get('expert-pairing:active:e-1:p-1')).toBe(second.pairingId);
    });

    it('未知 pairingId → null（无条目可删）', async () => {
      const { reg } = make();
      await expect(reg.revoke('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
    });
  });

  describe('getActive', () => {
    it('返回 {pairingId, device.uaSummary, pairedAt}', async () => {
      const { reg } = make();
      const res = await register(reg, 'u-1');
      const active = await reg.getActive('e-1', 'p-1');
      expect(active).toMatchObject({
        pairingId: res.pairingId,
        device: { uaSummary: DEVICE.uaSummary },
      });
      expect(typeof active!.pairedAt).toBe('number');
    });

    it('无配对 → null', async () => {
      const { reg } = make();
      await expect(reg.getActive('e-x', 'p-x')).resolves.toBeNull();
    });

    it('active 键指向的条目已消失（TTL 竞态窗）→ null（与 isAlive 口径一致）', async () => {
      const { fake, reg } = make();
      const res = await register(reg, 'u-1');
      fake.store.delete(`expert-pairing:${res.pairingId}`); // 模拟条目先过期
      await expect(reg.getActive('e-1', 'p-1')).resolves.toBeNull();
    });
  });

  describe('revokeForUser', () => {
    it('删该用户全部配对条目 + 各自 active 反向键；他用户条目保留', async () => {
      const { fake, reg } = make();
      const mine1 = await register(reg, 'u-me', '1');
      const mine2 = await register(reg, 'u-me', '2');
      const other = await register(reg, 'u-other', '3');

      await reg.revokeForUser('u-me');

      expect(fake.store.has(`expert-pairing:${mine1.pairingId}`)).toBe(false);
      expect(fake.store.has(`expert-pairing:${mine2.pairingId}`)).toBe(false);
      expect(fake.store.has('expert-pairing:active:e-1:p-1')).toBe(false);
      expect(fake.store.has('expert-pairing:active:e-2:p-2')).toBe(false);
      expect(fake.store.get(`expert-pairing:${other.pairingId}`)).toBeTruthy();
      expect(fake.store.get('expert-pairing:active:e-3:p-3')).toBe(other.pairingId);
    });

    it('active 键（值为裸 jti 字符串）不按值误判为条目——SCAN 值比对天然排除', async () => {
      const { fake, reg } = make();
      await register(reg, 'u-me');
      // 构造一个值恰好是数字串的 active 键（JSON.parse 可成功但非对象）——不得被当作条目删
      fake.store.set('expert-pairing:active:e-9:p-9', '12345');
      await reg.revokeForUser('u-me');
      expect(fake.store.get('expert-pairing:active:e-9:p-9')).toBe('12345');
    });

    it('无该用户配对 → 静默无操作', async () => {
      const { reg } = make();
      await expect(reg.revokeForUser('u-nobody')).resolves.toBeUndefined();
    });
  });

  describe('Redis 缺失（@Optional 注入未命中）', () => {
    it('五个写读入口均抛 ServiceUnavailableException', async () => {
      const reg = new ExpertPairingRegistry(undefined as unknown as Redis);
      const args = { userId: 'u', expertId: 'e', projectId: 'p', device: DEVICE };
      await expect(reg.register(args)).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(reg.isAlive('jti', 'u')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(reg.getActive('e', 'p')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(reg.revoke('jti')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(reg.revokeForUser('u')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});

describe('ExpertPairingModule（DI 接线冒烟）', () => {
  it('以 fake REDIS_CLIENT 装配 → registry 可解析并正常读写', async () => {
    const fake = new FakeRedis();
    const module: TestingModule = await Test.createTestingModule({
      // RedisModule 引入真实 'REDIS_CLIENT' 声明（override 后 factory 不再连真 Redis）
      imports: [ExpertPairingModule, RedisModule],
    })
      .overrideProvider('REDIS_CLIENT')
      .useValue(fake)
      .compile();

    const registry = module.get(ExpertPairingRegistry);
    const res = await registry.register({
      userId: 'u-1', expertId: 'e-1', projectId: 'p-1', device: DEVICE,
    });
    expect(fake.store.get('expert-pairing:active:e-1:p-1')).toBe(res.pairingId);
    await module.close();
  });
});
