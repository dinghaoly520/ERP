/**
 * 对比 v4-pro vs v4-flash 在评分要点提取上的质量（只读，不落库）。
 * 用法：export DEEPSEEK_MODEL=deepseek-v4-pro && npx tsx prisma/scripts/compare-models.ts
 *      export DEEPSEEK_MODEL=deepseek-v4-flash && npx tsx prisma/scripts/compare-models.ts
 * 对每个 score item 调 extractor.extractScorePoints（不落库），打印建议。
 */
import { config } from 'dotenv';
import { join } from 'node:path';
config({ path: join(__dirname, '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../dist/prisma/prisma.module';
import { RedisModule } from '../../dist/redis/redis.module';
import { StorageModule } from '../../dist/storage/storage.module';
import { LocalAiModule } from '../../dist/local-ai/local-ai.module';
import { AiBidAnalysisModule } from '../../dist/ai-bid-analysis/ai-bid-analysis.module';
import { ScorePointExtractorService } from '../../dist/bid/score-point-extractor.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL || 'redis://localhost:6380' } }),
    PrismaModule, RedisModule, StorageModule, LocalAiModule, AiBidAnalysisModule,
  ],
  providers: [ScorePointExtractorService],
})
class CompareModule {}

const prisma = new PrismaClient();
const PROJECT_CODE = 'BID-2026-YDJM1';

async function main() {
  const runs = parseInt(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? '1');
  const model = process.env.DEEPSEEK_MODEL;
  console.log(`\n############ model=${model} runs=${runs} ############`);
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在');
  const app = await NestFactory.createApplicationContext(CompareModule, { logger: ['error', 'warn'] });
  try {
    const cfg = app.get(ConfigService);
    console.log(`[确认] LlmService 将用 model=${cfg.get<string>('DEEPSEEK_MODEL')}（env DEEPSEEK_MODEL=${process.env.DEEPSEEK_MODEL}）`);
    const extractor = app.get(ScorePointExtractorService);
    const items = await prisma.bidScoreItem.findMany({
      where: { projectId: project.id, category: { in: ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL'] } },
    });
    const stats: Record<string, { counts: number[]; names: Map<string, number>; times: number[] }> = {};
    for (const item of items) stats[item.category] = { counts: [], names: new Map(), times: [] };
    for (let r = 1; r <= runs; r++) {
      console.log(`\n----- run ${r}/${runs} -----`);
      for (const item of items) {
        const t0 = Date.now();
        let names: string[] = [];
        try {
          const suggestions = await extractor.extractScorePoints(project.id, item.id);
          names = suggestions.map((s) => s.name);
          const dt = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`  ${item.category}: ${suggestions.length} 项 (${dt}s)`);
          for (const s of suggestions) console.log(`    - ${s.name}`);
          stats[item.category].times.push(Number(dt));
        } catch (e) {
          console.warn(`  ${item.category}: ⚠失败 ${((Date.now() - t0) / 1000).toFixed(1)}s ${(e as Error).message}`);
        }
        stats[item.category].counts.push(names.length);
        for (const n of names) stats[item.category].names.set(n, (stats[item.category].names.get(n) ?? 0) + 1);
      }
    }
    console.log(`\n===== ${model} 汇总(runs=${runs}) =====`);
    for (const cat of Object.keys(stats)) {
      const s = stats[cat];
      const avg = (s.counts.reduce((a, b) => a + b, 0) / s.counts.length).toFixed(1);
      const avgT = s.times.length ? (s.times.reduce((a, b) => a + b, 0) / s.times.length).toFixed(1) : '-';
      console.log(`${cat}: 每次项数=[${s.counts.join(',')}] avg=${avg}  耗时avg=${avgT}s`);
      const threshold = Math.ceil(runs / 2);
      const stable = [...s.names.entries()].filter(([, c]) => c >= threshold).sort((a, b) => b[1] - a[1]);
      console.log(`  稳定项(≥${threshold}/${runs}次): ${stable.length}`);
      for (const [n, c] of stable) console.log(`    ${c}/${runs}  ${n}`);
    }
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
