/**
 * 一次性回填脚本：对 aiSummary 为空的公告调用 DeepSeek 生成 AI 摘要。
 *
 * 用法：
 *   cd apps/api && npx tsx prisma/scripts/backfill-ai-summary.ts
 *
 * 幂等：已有 aiSummary 的公告自动跳过。DeepSeek 未配置时直接退出。
 */
import { PrismaClient } from '@prisma/client';
import { LlmService } from '../../src/local-ai/llm.service';
import { AnnouncementAiService } from '../../src/announcement/announcement-ai.service';

const prisma = new PrismaClient();

const TYPE_LABELS: Record<string, string> = {
  BID_NOTICE: '招标公告', WIN_NOTICE: '中标公示', POLICY: '政策法规', PLATFORM: '平台通知',
};

async function main() {
  const envConfig = { get: (k: string, d?: any) => (process.env[k] ?? d) } as any;
  const llm = new LlmService(envConfig);
  const ai = new AnnouncementAiService(llm, envConfig);

  if (!ai.isConfigured()) {
    console.error('✖ DeepSeek 未配置（DEEPSEEK_API_KEY 缺失），退出');
    process.exit(1);
  }

  const need = await prisma.announcement.findMany({
    where: { OR: [{ aiSummary: null }, { aiSummary: '' }] },
    select: { id: true, title: true, type: true, content: true },
  });

  console.log(`▶ 找到 ${need.length} 条 aiSummary 为空的公告，开始回填…\n`);

  let filled = 0;
  let failed = 0;
  for (const ann of need) {
    const label = TYPE_LABELS[ann.type] ?? ann.type;
    process.stdout.write(`  [${label}] ${ann.title.slice(0, 30)}… → `);
    try {
      const summary = await ai.summarize({ title: ann.title, type: label, content: ann.content });
      if (summary) {
        await prisma.announcement.update({ where: { id: ann.id }, data: { aiSummary: summary } });
        filled++;
        console.log(`✓ (${summary.length} 字)`);
      } else {
        failed++;
        console.log('✖ 生成失败（返回空）');
      }
    } catch (e) {
      failed++;
      console.log(`✖ ${(e as Error).message}`);
    }
  }

  console.log(`\n✔ 完成：成功 ${filled}、失败 ${failed}、共 ${need.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
