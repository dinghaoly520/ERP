import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import type Redis from 'ioredis';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  @Public()
  getOverview() {
    return {
      name: '智慧水发·蜀水云采 ERP API',
      version: '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
    };
  }

  @Get('health')
  @Public()
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
