// apps/api/src/ai-bid-analysis-worker.ts
// AI 投标分析 worker 进程入口（独立于 api 主进程）
// processors 自动消费队列；不监听 HTTP 端口
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AiBidAnalysisWorkerModule } from './ai-bid-analysis-worker.module';

async function bootstrap() {
  const logger = new Logger('AiBidAnalysisWorker');
  const app = await NestFactory.createApplicationContext(
    AiBidAnalysisWorkerModule,
  );
  logger.log('AI 投标分析 worker 已启动（消费 tender/bidder 队列）');

  // 优雅关闭
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM received, closing worker...');
    await app.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker bootstrap failed:', err);
  process.exit(1);
});
