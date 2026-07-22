/**
 * CI 回归脚本：对比指定模型在评分要点提取上的质量（只读，不落库）。
 * 用法：npx tsx prisma/scripts/compare-models-ci.ts \
 *         --model=deepseek-v4-flash --runs=5 --threshold=3 \
 *         --categories=QUALIFICATION,RESPONSIVE,BUSINESS,TECHNICAL
 * 输出 JSON：{ model, runs, threshold, results: [{ category, avg, stable, items }], pass }
 * 退出码：0=全部达标（avg≥threshold），1=有类低于阈值（CI 告警）
 *
 * 模型升级预留：新模型发布时跑此脚本对比质量，达标则改 AI_SCORE_CATEGORIES 切回 AI。
 */
import { config } from 'dotenv';
import { join } from 'node:path';
config({ path: join(__dirname, '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}

async function main() {
  const model = arg('model', process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash');
  const runs = parseInt(arg('runs', '5'));
  const threshold = parseFloat(arg('threshold', '3'));
  const categories = arg('categories', 'QUALIFICATION,RESPONSIVE,BUSINESS,TECHNICAL').split(',').map((s) => s.trim());

  process.env.DEEPSEEK_MODEL = model; // 覆盖 env，让 LlmService 用指定 model

  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error(`项目 ${PROJECT_CODE} 不存在`);
  const app = await NestFactory.createApplicationContext(CompareModule, { logger: ['error'] });
  try {
    const extractor = app.get(ScorePointExtractorService);
    const items = await prisma.bidScoreItem.findMany({
      where: { projectId: project.id, category: { in: categories } },
    });
    const stats: Record<string, { counts: number[]; names: Map<string, number> }> = {};
    for (const item of items) stats[item.category] = { counts: [], names: new Map() };

    for (let r = 1; r <= runs; r++) {
      for (const item of items) {
        let names: string[] = [];
        try {
          const suggestions = await extractor.extractScorePoints(project.id, item.id);
          names = suggestions.map((s) => s.name);
        } catch {
          // 提取失败记 0 项
        }
        stats[item.category].counts.push(names.length);
        for (const n of names) stats[item.category].names.set(n, (stats[item.category].names.get(n) ?? 0) + 1);
      }
    }

    const stableThreshold = Math.ceil(runs / 2);
    const results = Object.keys(stats).map((cat) => {
      const s = stats[cat];
      const avg = s.counts.reduce((a, b) => a + b, 0) / s.counts.length;
      const stable = [...s.names.entries()].filter(([, c]) => c >= stableThreshold).map(([n]) => n);
      return { category: cat, avg: Math.round(avg * 10) / 10, stable: stable.length, items: stable };
    });
    const pass = results.every((r) => r.avg >= threshold);

    console.log(JSON.stringify({ model, runs, threshold, results, pass }, null, 2));
    process.exit(pass ? 0 : 1);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
