import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        // 统一与 BullMQ（app.module.ts / ai-bid-analysis-worker.module.ts）走同一条配置轨：
        // 优先 REDIS_URL（与 BullMQ 一致），无则回退到 REDIS_HOST/REDIS_PORT（旧轨，向后兼容）。
        // 这样默认情况下一份 REDIS_URL 即可同时驱动 ioredis 客户端与 BullMQ 队列，
        // 杜绝「两条轨指向不同实例」的潜在漂移。
        const url = process.env.REDIS_URL;
        if (url) {
          return new Redis(url, { family: 4, maxRetriesPerRequest: 3 });
        }
        const host = process.env.REDIS_HOST || '127.0.0.1';
        const port = parseInt(process.env.REDIS_PORT || '6380', 10);
        return new Redis({ host, port, family: 4, maxRetriesPerRequest: 3 });
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
