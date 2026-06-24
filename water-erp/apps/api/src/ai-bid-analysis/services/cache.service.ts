// apps/api/src/ai-bid-analysis/services/cache.service.ts
import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private cache = new Map<string, CacheEntry<any>>();
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTTL): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  clearByPattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  // 任务相关的缓存键生成
  getTaskCacheKey(taskId: string, type: string): string {
    return `ai-bid-analysis:task:${taskId}:${type}`;
  }

  // 清除任务的所有缓存
  clearTaskCache(taskId: string): void {
    this.clearByPattern(`ai-bid-analysis:task:${taskId}:`);
  }

  // 获取或设置缓存
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs = this.defaultTTL,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      this.logger.debug(`Cache hit: ${key}`);
      return cached;
    }

    this.logger.debug(`Cache miss: ${key}`);
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }
}
