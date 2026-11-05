import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        // 与 BullMQ（app.module.ts / ai-bid-analysis-worker.module.ts）同一配置轨：优先
        // REDIS_URL，回退 REDIS_HOST/REDIS_PORT（旧轨兼容）——一份 URL 同驱 ioredis 与 BullMQ，杜绝两轨漂移。
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
