import {
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * TAB-SYNC-01 平板配对登记（Redis）——单台平板配对的生命周期登记处。
 * 设计：平板扫码/口令领取后获得受限 JWT（jti=pairingId），其存活状态由本登记处跟踪；
 * 同一 expert+project 仅允许一台平板（register 单飞替换旧 jti）。
 *
 * 键契约（TTL 统一 12h，与受限令牌生命周期上限对齐）：
 *   expert-pairing:{jti}             → JSON {userId, expertId, projectId, pairedAt, device}
 *   expert-pairing:active:{eid}:{pid} → jti 字符串（反向索引，供主持端 getActive / register 替换）
 *   expert-pairing:lock:{eid}:{pid}   → '1'（register 短锁，TTL 5s；瞬时键，非配对数据）
 */
const ENTRY_KEY_PREFIX = 'expert-pairing:';
const ACTIVE_KEY_PREFIX = 'expert-pairing:active:';
const LOCK_KEY_PREFIX = 'expert-pairing:lock:';
const PAIRING_TTL_SECONDS = 12 * 3600;
const REGISTER_LOCK_TTL_SECONDS = 5;

export interface ExpertPairingDevice {
  uaSummary: string;
  ip?: string | null;
}

export interface ExpertPairingEntry {
  userId: string;
  expertId: string;
  projectId: string;
  pairedAt: number;
  device: ExpertPairingDevice;
}

@Injectable()
export class ExpertPairingRegistry {
  constructor(
    // 与 auth.service.ts 同款：@Global RedisModule 提供 'REDIS_CLIENT'，Optional 仅防测试直构
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  private client(): Redis {
    if (!this.redis) throw new ServiceUnavailableException('Redis 不可用，平板配对登记不可用');
    return this.redis;
  }

  /** 登记新配对。同 expert+project 已有旧配对时单飞替换（旧 jti 条目即删，旧平板令牌随之失效）。
   *  并发互斥（评审 F1 裁定）：GET active → DEL → SET → SET 非原子，并发 register 会留下双活动
   *  条目（败者 jti 经 isAlive 存活 12h）——按 expert+project 短锁串行化，锁获取失败 409 让
   *  调用方稍候重试（沿用 expert-transfer 票据锁模式，auth.service claimExpertTransfer）。 */
  async register(args: {
    userId: string;
    expertId: string;
    projectId: string;
    device: ExpertPairingDevice;
  }): Promise<{ pairingId: string; replaced: string | null }> {
    const redis = this.client();
    const activeKey = `${ACTIVE_KEY_PREFIX}${args.expertId}:${args.projectId}`;
    const lockKey = `${LOCK_KEY_PREFIX}${args.expertId}:${args.projectId}`;
    const locked = await redis.set(lockKey, '1', 'EX', REGISTER_LOCK_TTL_SECONDS, 'NX');
    if (!locked) {
      throw new ConflictException({
        error: '配对操作正在进行中，请稍候重试',
        code: 'PAIRING_IN_PROGRESS',
      });
    }
    try {
      const oldJti = await redis.get(activeKey);
      let replaced: string | null = null;
      if (oldJti) {
        await redis.del(`${ENTRY_KEY_PREFIX}${oldJti}`);
        replaced = oldJti;
      }
      const pairingId = randomUUID();
      const entry: ExpertPairingEntry = {
        userId: args.userId,
        expertId: args.expertId,
        projectId: args.projectId,
        pairedAt: Date.now(),
        device: args.device,
      };
      await redis.set(`${ENTRY_KEY_PREFIX}${pairingId}`, JSON.stringify(entry), 'EX', PAIRING_TTL_SECONDS);
      await redis.set(activeKey, pairingId, 'EX', PAIRING_TTL_SECONDS);
      return { pairingId, replaced };
    } finally {
      await this.releaseLock(redis, lockKey);
    }
  }

  /** 配对令牌是否存活（AuthGuard 逐请求调用）：条目在且 userId 匹配。 */
  async isAlive(pairingId: string, userId: string): Promise<boolean> {
    const redis = this.client();
    const raw = await redis.get(`${ENTRY_KEY_PREFIX}${pairingId}`);
    if (!raw) return false;
    try {
      return (JSON.parse(raw) as ExpertPairingEntry).userId === userId;
    } catch {
      return false;
    }
  }

  /** 当前活跃配对（主持端面板）。active 键在而条目已过期（TTL 竞态窗）→ null，与 isAlive 口径一致。
   *  device 投影透传 ip（评审 F2：与 ExpertPairingDevice 绑定约束签名 {uaSummary, ip} 对齐）。 */
  async getActive(
    expertId: string,
    projectId: string,
  ): Promise<{
    pairingId: string;
    device: { uaSummary: string; ip?: string | null } | null;
    pairedAt: number;
  } | null> {
    const redis = this.client();
    const pairingId = await redis.get(`${ACTIVE_KEY_PREFIX}${expertId}:${projectId}`);
    if (!pairingId) return null;
    const raw = await redis.get(`${ENTRY_KEY_PREFIX}${pairingId}`);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as ExpertPairingEntry;
      return {
        pairingId,
        device: entry.device && typeof entry.device.uaSummary === 'string'
          ? { uaSummary: entry.device.uaSummary, ip: entry.device.ip ?? null }
          : null,
        pairedAt: entry.pairedAt,
      };
    } catch {
      return null;
    }
  }

  /** 吊销单条配对（解绑/登出）。返回被删条目供监督日志；无条目 → null。
   *  反向 active 键仅当仍指向本配对时清除——并发下新配对已覆盖时不得误删。 */
  async revoke(
    pairingId: string,
  ): Promise<{ userId: string; expertId: string; projectId: string } | null> {
    const redis = this.client();
    const key = `${ENTRY_KEY_PREFIX}${pairingId}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    let entry: ExpertPairingEntry;
    try {
      entry = JSON.parse(raw) as ExpertPairingEntry;
    } catch {
      await redis.del(key); // 损坏条目：清键即止，无可供监督日志的元数据
      return null;
    }
    await redis.del(key);
    await this.clearActiveKeyIfPointsTo(redis, entry.expertId, entry.projectId, pairingId);
    return { userId: entry.userId, expertId: entry.expertId, projectId: entry.projectId };
  }

  /** 吊销某用户全部配对（登出/账号侧全撤）。SCAN 全键 + 值比对（低频调用，SCAN 可接受）：
   *  active 键值为裸 jti 串，JSON.parse 后非带 userId 的对象，天然被排除。 */
  async revokeForUser(userId: string): Promise<void> {
    const redis = this.client();
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', `${ENTRY_KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      for (const key of batch) {
        const raw = await redis.get(key);
        if (!raw || !key.startsWith(ENTRY_KEY_PREFIX)) continue;
        let entry: ExpertPairingEntry | null = null;
        try {
          const parsed = JSON.parse(raw) as Partial<ExpertPairingEntry>;
          if (typeof parsed.userId === 'string') entry = parsed as ExpertPairingEntry;
        } catch {
          entry = null; // active 键的裸 jti 值（或损坏数据）——非条目
        }
        if (!entry || entry.userId !== userId) continue;
        const jti = key.slice(ENTRY_KEY_PREFIX.length);
        await redis.del(key);
        await this.clearActiveKeyIfPointsTo(redis, entry.expertId, entry.projectId, jti);
      }
    } while (cursor !== '0');
  }

  /** 释放 register 短锁：DEL 前比对值仍为 '1'（本锁标记）防误删他人锁——锁过期后他人重取时
   *  键可能已被覆盖；释放失败不掩盖注册结果（catch 吞掉，锁 TTL 5s 兜底自清）。 */
  private async releaseLock(redis: Redis, lockKey: string): Promise<void> {
    const lockVal = await redis.get(lockKey).catch(() => null);
    if (lockVal === '1') await redis.del(lockKey).catch(() => {});
  }

  private async clearActiveKeyIfPointsTo(
    redis: Redis,
    expertId: string,
    projectId: string,
    jti: string,
  ): Promise<void> {
    const activeKey = `${ACTIVE_KEY_PREFIX}${expertId}:${projectId}`;
    const current = await redis.get(activeKey);
    if (current === jti) await redis.del(activeKey);
  }
}
