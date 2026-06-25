// apps/api/src/ai-bid-analysis/services/cache.service.ts
// B9 (15.7): Redis-backed LLM 响应缓存 — 替换内存 Map，按 seed + prompt hash 去重
import { Injectable, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import * as crypto from 'crypto';

const KEY_PREFIX = 'ai-bid:cache:';
const DEFAULT_TTL = 7 * 24 * 3600; // 7 天（LLM 响应很少变化）

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(KEY_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (e) {
      this.logger.warn(`Cache get error: ${key} ${(e as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL): Promise<void> {
    try {
      await this.redis.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (e) {
      this.logger.warn(`Cache set error: ${key} ${(e as Error).message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(KEY_PREFIX + key);
    } catch (e) {
      this.logger.warn(`Cache del error: ${key} ${(e as Error).message}`);
    }
  }

  async clear(): Promise<void> {
    await this.clearByPattern('*');
  }

  async clearByPattern(pattern: string): Promise<void> {
    try {
      const match = KEY_PREFIX + pattern;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH', match,
          'COUNT', 100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          this.logger.debug(`Cleared ${keys.length} cache keys matching "${pattern}"`);
        }
      } while (cursor !== '0');
    } catch (e) {
      this.logger.warn(`Cache clearByPattern error: ${pattern} ${(e as Error).message}`);
    }
  }

  /** 任务相关的缓存键（seed = taskId） */
  getTaskCacheKey(taskId: string, type: string): string {
    return `task:${taskId}:${type}`;
  }

  /** 按 seed + prompt 生成确定性缓存键（LLM 调用去重） */
  getPromptCacheKey(seed: string, prompt: string): string {
    const hash = crypto.createHash('md5').update(`${seed}\n${prompt}`).digest('hex');
    return `llm:${seed}:${hash}`;
  }

  /** 清除任务的所有缓存 */
  async clearTaskCache(taskId: string): Promise<void> {
    await this.clearByPattern(`task:${taskId}:*`);
  }

  /** 获取或设置缓存（线程安全的 getOrSet） */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds = DEFAULT_TTL,
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key);
      if (cached !== null) {
        this.logger.debug(`Cache hit: ${key}`);
        return cached;
      }
    } catch (e) {
      // Redis 读取失败时静默降级到 factory
    }

    this.logger.debug(`Cache miss: ${key}`);
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
