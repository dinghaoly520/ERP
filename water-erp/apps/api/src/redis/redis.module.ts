import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6380', 10);
        return new Redis({ host, port, maxRetriesPerRequest: 3 });
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
