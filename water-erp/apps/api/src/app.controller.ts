import { Public } from './common/decorators/public.decorator';
import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  getOverview() {
    return {
      name: '智慧水发·蜀水云采 ERP API',
      version: '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
    };
  }

  /** W4/A-97~A-98：国家授时中心标准时间（服务器经 chronyd 同步 ntp.ac.cn，见 docs/ops-ntp.md）。
   * 客户端经 serverClock() 算 offset 后统一用 serverNow()，杜绝本地时间被篡改导致的截止误判。 */
  @Public()
  @Get('time')
  getTime() {
    const now = Date.now();
    return { serverTime: now, iso: new Date(now).toISOString(), source: 'server-clock' };
  }

  @Get('health')
  async getHealth() {
    let dbOk = false;
    let redisOk = false;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch { /* database unavailable */ }

    try {
      await this.redis.ping();
      redisOk = true;
    } catch { /* redis unavailable */ }

    const allHealthy = dbOk && redisOk;

    return {
      status: allHealthy ? 'ok' : 'degraded',
      service: 'water-erp-api',
      environment: process.env.NODE_ENV ?? 'development',
      checks: {
        database: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
