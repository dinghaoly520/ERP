/**
 * 引大济岷钻孔项目真实评审数据 + AI 评分要点提取（一次性、幂等、非破坏性）。
 * 按 --step=<name> 分段执行；每步独立可验证。
 *   basics   → 3 家 Supplier/User + BidProject + Announcement
 *   tender   → 招标文件 docx→pdf→加密→MinIO→BidDocument
 *   bids     → 3 家 BidSupplier + 投标 PDF 明文入库 + SupplierBidSubmission
 *   score    → BidOpeningSession + 5 个 BidScoreItem
 *   experts  → 6 名 BidExpert（含阴红宇 isLead）
 *   ai       → bootstrap Nest，跑 ScorePointExtractorService 提取得分点
 *   advance  → stage=EVALUATING + supervision log + 占位 AiBidAnalysisTask
 *   all      → 顺序执行全部 step
 *
 * 运行：cd apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=<name>
 */
import { config } from 'dotenv';
import { join } from 'node:path';
// 显式加载 apps/api/.env（tsx 直跑不会自动读 .env）
config({ path: join(__dirname, '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

const PROJECT_CODE = 'BID-2026-YDJM1';
const KMS = process.env.KMS_SECRET;
if (!KMS) throw new Error('KMS_SECRET 未配置（apps/api/.env）');

const FILE_DIR = '/home/asus/桌面/procurement/资料/标书及投标文件';
const TENDER_DOCX = `${FILE_DIR}/2026.1.27勘察分院-引大济岷工程千ZK10和千隧ZK12两个钻孔施工技术服务内部竞标（竞价）采购文件.docx`;
const BID_PDFS: { name: string; path: string }[] = [
  { name: '成都华建地质工程科技有限公司', path: `${FILE_DIR}/引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（成都华建地质工程科技有限公司).pdf` },
  { name: '四川省第十二地质大队', path: `${FILE_DIR}/引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（四川省第十二地质大队）.pdf` },
  { name: '四川省第四地质大队', path: `${FILE_DIR}/引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务-四川省第四地质大队.pdf` },
];

async function stepBasics() { console.log('▶ basics（Task 1 填充）'); }
async function stepTender() { console.log('▶ tender（Task 2 填充）'); }
async function stepBids() { console.log('▶ bids（Task 3 填充）'); }
async function stepScore() { console.log('▶ score（Task 4 填充）'); }
async function stepExperts() { console.log('▶ experts（Task 5 填充）'); }
async function stepAi() { console.log('▶ ai（Task 6 填充）'); }
async function stepAdvance() { console.log('▶ advance（Task 7 填充）'); }

const STEPS: Record<string, () => Promise<void>> = {
  basics: stepBasics, tender: stepTender, bids: stepBids, score: stepScore,
  experts: stepExperts, ai: stepAi, advance: stepAdvance,
};

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--step='));
  const step = arg ? arg.split('=')[1] : 'all';
  console.log(`seed-yindajimin: step=${step}`);
  if (step === 'all') {
    for (const fn of [stepBasics, stepTender, stepBids, stepScore, stepExperts, stepAi, stepAdvance]) {
      await fn();
    }
  } else if (STEPS[step]) {
    await STEPS[step]();
  } else {
    console.error(`未知 step: ${step}（可用: ${Object.keys(STEPS).join(', ')}, all）`);
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
