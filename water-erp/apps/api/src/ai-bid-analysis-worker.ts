// apps/api/src/ai-bid-analysis-worker.ts
// AI 投标分析 worker 进程入口（独立于 api 主进程）
// processors 自动消费队列；不监听 HTTP 端口
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AiBidAnalysisWorkerModule } from './ai-bid-analysis-worker.module';

async function bootstrap() {
  const logger = new Logger('AiBidAnalysisWorker');
  const app = await NestFactory.createApplicationContext(
    AiBidAnalysisWorkerModule,
  );
  logger.log('AI 投标分析 worker 已启动（消费 tender/bidder 队列）');

  // 心跳（30s，TTL 90s）：health 端点读 sys:aiworker:hb:* 判「分析服务运行中」
  const redis = app.get('REDIS_CLIENT', { strict: false }) as Redis;
  const HB_KEY = `sys:aiworker:hb:${process.pid}`;
  const beat = () => redis.set(HB_KEY, new Date().toISOString(), 'EX', 90).catch(() => undefined);
  void beat();
  const hbTimer = setInterval(beat, 30_000);
  hbTimer.unref?.();

  // 优雅关闭（清心跳键后退出）
  const shutdown = async (sig: string) => {
    logger.log(`${sig} received, closing worker...`);
    clearInterval(hbTimer);
    await redis.del(HB_KEY).catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
   
  console.error('Worker bootstrap failed:', err);
  process.exit(1);
});
