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
import { minioClient, MINIO_BUCKET } from '../../src/upload/minio.client';
import { encryptBuffer } from '../../src/announcement/bid-document.crypto';
import { wrapKey } from '../../src/common/crypto/envelope-crypto';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
// Nest DI 相关从编译产物 dist 引入（tsx/esbuild 不生成 emitDecoratorMetadata，
// 直接 import src 会让 Nest 构造注入失败；dist 由 tsc 编译含 reflect-metadata）
import { PrismaModule } from '../../dist/prisma/prisma.module';
import { RedisModule } from '../../dist/redis/redis.module';
import { StorageModule } from '../../dist/storage/storage.module';
import { LocalAiModule } from '../../dist/local-ai/local-ai.module';
import { AiBidAnalysisModule } from '../../dist/ai-bid-analysis/ai-bid-analysis.module';
import { ScorePointExtractorService } from '../../dist/bid/score-point-extractor.service';

// 精简 module：只引入 ScorePointExtractorService 所需依赖（LocalAiModule 是 @Global 提供 LLM/OCR/Embedding，
// AiBidAnalysisModule 提供 PlaintextFetcherService，PrismaModule 提供 PrismaService）。
// 避开 AppModule 全量初始化——它在 createApplicationContext 下会触发 BidService 的 context 模式依赖问题。
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL || 'redis://localhost:6380' } }),
    PrismaModule,
    RedisModule,
    StorageModule,
    LocalAiModule,
    AiBidAnalysisModule,
  ],
  providers: [ScorePointExtractorService],
})
class SeedYindajiminModule {}

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

async function stepBasics() {
  console.log('▶ basics: Supplier ×3 + BidProject + Announcement');

  // ── 3 家 Supplier（按 normalizedName 复用已存在的真实供应商，如 procurement 移植数据；不存在才新建 User+Supplier）──
  for (const s of BID_PDFS) {
    const existingSupp = await prisma.supplier.findUnique({ where: { normalizedName: s.name.trim().toLowerCase() } });
    if (existingSupp) {
      console.log(`  · Supplier「${s.name}」已存在，复用 (id=${existingSupp.id})`);
      continue;
    }
    const u = await prisma.user.create({
      data: {
        username: s.name,
        displayName: s.name,
        passwordHash: hashSync(`${s.name}@2026`, 10),
        role: 'supplier',
        isActive: true,
      },
    });
    await prisma.supplier.create({
      data: {
        userId: u.id,
        name: s.name,
        normalizedName: s.name.trim().toLowerCase(),
        enterpriseType: s.name.includes('地质大队') ? '事业单位' : '有限责任公司',
        legalPerson: '-',
        registeredAddress: '-',
        businessScope: '地质钻探技术服务',
        status: 'APPROVED',
      },
    });
    console.log(`  + Supplier「${s.name}」userId=${u.id}`);
  }

  // ── BidProject（幂等：存在则跳过）──
  const existing = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (existing) {
    console.log(`  · BidProject「${PROJECT_CODE}」已存在，跳过 (id=${existing.id})`);
    return;
  }
  const project = await prisma.bidProject.create({
    data: {
      projectCode: PROJECT_CODE,
      name: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务',
      procurementMethod: '内部竞标（竞价）',
      openTime: new Date('2026-07-25T02:00:00.000Z'),
      deadline: new Date('2026-07-24T01:00:00.000Z'),
      stage: 'DOWNLOAD',
      scope: '为查明引大济岷隧洞工程地质条件，在千池山隧洞洞身中段布置千隧ZK10（700m）和千隧ZK12（600m）两个斜钻孔。',
      qualification:
        '1.具有独立法人资格；2.具备工程钻探劳务资质或在中国矿业联合会地质勘查信用信息公示系统红名单内；3.近5年内至少有两项类似项目钻探业绩（500米及以上水平或倾斜钻孔施工）。',
      contact: '四川水发勘测设计研究有限公司 勘察分院',
      bondRequired: false,
    },
  });
  console.log(`  + BidProject id=${project.id} code=${PROJECT_CODE}`);

  // ── Announcement（BID_NOTICE / PUBLISHED）──
  const ann = await prisma.announcement.findFirst({ where: { relatedProjectCode: PROJECT_CODE } });
  if (ann) {
    console.log(`  · Announcement 已存在，跳过 (id=${ann.id})`);
    return;
  }
  const staff = await prisma.user.findFirst({ where: { role: 'procurement_staff' } });
  await prisma.announcement.create({
    data: {
      title: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务 采购公告',
      content: '四川水发勘测设计研究有限公司拟对引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务采用内部竞标（竞价）方式进行采购，兹邀请符合要求的供应商参加投标。',
      type: 'BID_NOTICE',
      status: 'PUBLISHED',
      relatedProjectCode: PROJECT_CODE,
      publishDate: new Date(),
      authorId: staff?.id ?? null,
    },
  });
  console.log('  + Announcement BID_NOTICE/PUBLISHED');
}
async function stepTender() {
  console.log('▶ tender: docx→pdf→加密→MinIO→BidDocument');
  const ann = await prisma.announcement.findFirst({ where: { relatedProjectCode: PROJECT_CODE } });
  if (!ann) throw new Error('公告不存在，请先跑 --step=basics');

  // docx → pdf（libreoffice headless）
  execSync(`libreoffice --headless --convert-to pdf --outdir /tmp "${TENDER_DOCX}"`, { stdio: 'pipe' });
  const pdfPath = '/tmp/' + TENDER_DOCX.split('/').pop()!.replace(/\.docx$/i, '.pdf');
  const plaintext = readFileSync(pdfPath);
  console.log(`  · 招标 PDF 明文 ${plaintext.length}B`);

  const TENDER_KEY = 'yindajimin/tender.pdf';
  const sha = createHash('sha256').update(plaintext).digest('hex');

  const asset = await prisma.fileAsset.upsert({
    where: { key: TENDER_KEY },
    create: { key: TENDER_KEY, originalName: '引大济岷钻孔项目招标文件.pdf', mimeType: 'application/pdf', size: plaintext.length, sha256: sha, category: 'tender', sealedPath: TENDER_KEY },
    update: { size: plaintext.length, sha256: sha, sealedPath: TENDER_KEY },
  });

  const { ciphertext, decryptKey } = encryptBuffer(plaintext);
  await minioClient.putObject(MINIO_BUCKET, TENDER_KEY, ciphertext, ciphertext.length, { 'Content-Type': 'application/pdf' });
  const wrapped = wrapKey(decryptKey, KMS!);

  await prisma.bidDocument.upsert({
    where: { announcementId: ann.id },
    create: { announcementId: ann.id, fileAssetId: asset.id, title: '引大济岷钻孔项目招标文件', accessScope: 'OPEN', decryptKey: wrapped },
    update: { fileAssetId: asset.id, decryptKey: wrapped },
  });
  console.log(`  + BidDocument（announcementId=${ann.id}, asset=${asset.id}, decryptKey 已 wrap）`);
}
async function stepBids() {
  console.log('▶ bids: 3 家 BidSupplier + 投标 PDF 明文入库 + Submission');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在，请先跑 --step=basics');

  for (const [i, b] of BID_PDFS.entries()) {
    const n = i + 1;
    const supplier = await prisma.supplier.findFirst({ where: { name: b.name } });
    if (!supplier) throw new Error(`Supplier「${b.name}」不存在，请先跑 --step=basics`);

    // FileAsset（投标 PDF 明文）— 幂等
    const key = `yindajimin/bid-${n}.pdf`;
    const buf = readFileSync(b.path);
    const sha = createHash('sha256').update(buf).digest('hex');
    const asset = await prisma.fileAsset.upsert({
      where: { key },
      create: { key, originalName: `${b.name}-投标文件.pdf`, mimeType: 'application/pdf', size: buf.length, sha256: sha, category: 'bid', sealedPath: key },
      update: { size: buf.length, sha256: sha, sealedPath: key },
    });
    await minioClient.putObject(MINIO_BUCKET, key, buf, buf.length, { 'Content-Type': 'application/pdf' });

    // BidSupplier（@@unique [projectId, supplierName]）— decryptStatus=SUCCESS
    const bs = await prisma.bidSupplier.upsert({
      where: { projectId_supplierName: { projectId: project.id, supplierName: b.name } },
      create: { projectId: project.id, supplierId: supplier.id, supplierName: b.name, downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '校验通过', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
      update: { supplierId: supplier.id, decryptStatus: 'SUCCESS', submitStatus: '已提交', confirmStatus: 'CONFIRMED' },
    });

    // SupplierBidSubmission（@@unique [supplierId, projectId]）— 明文兼容：sealedKey=null
    await prisma.supplierBidSubmission.upsert({
      where: { supplierId_projectId: { supplierId: supplier.id, projectId: project.id } },
      create: { supplierId: supplier.id, projectId: project.id, technicalFileAssetId: asset.id, businessFileAssetId: asset.id, status: 'submitted', submittedAt: new Date() },
      update: { technicalFileAssetId: asset.id, businessFileAssetId: asset.id, status: 'submitted' },
    });
    console.log(`  + [${n}] ${b.name} bidSupplier=${bs.id} asset=${asset.id} (${buf.length}B 明文)`);
  }
}
async function stepScore() {
  console.log('▶ score: BidOpeningSession + 5 个 BidScoreItem');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在，请先跑 --step=basics');

  await prisma.bidOpeningSession.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, host: '李主任', supervisor: '周老师', status: '已开标', decryptWindowStart: new Date('2026-07-25T02:00:00.000Z'), decryptWindowEnd: new Date('2026-07-25T06:00:00.000Z') },
    update: { status: '已开标' },
  });
  console.log('  + BidOpeningSession（已开标）');

  const items = [
    { category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
    { category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
    { category: 'BUSINESS', name: '商务评分', maxScore: 20 },
    { category: 'TECHNICAL', name: '技术评分', maxScore: 30 },
    { category: 'PRICE', name: '价格评分', maxScore: 50 },
  ] as const;
  for (const it of items) {
    const exist = await prisma.bidScoreItem.findFirst({ where: { projectId: project.id, category: it.category } });
    if (exist) { console.log(`  · BidScoreItem ${it.category} 已存在，跳过`); continue; }
    await prisma.bidScoreItem.create({ data: { projectId: project.id, category: it.category, name: it.name, maxScore: it.maxScore } });
    console.log(`  + BidScoreItem ${it.category} maxScore=${it.maxScore}`);
  }
}
async function stepExperts() {
  console.log('▶ experts: 6 名 BidExpert（cmqhero 班底 5 + 阴红宇 isLead）');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在，请先跑 --step=basics');

  const EXPERT_NAMES = ['周祥志', '黃凯', '陈英', '范鸿烨', '覃克非', '阴红宇'];
  const yinhongyuId = 'c826709c602085d0d94cc2a';
  for (const name of EXPERT_NAMES) {
    const user = name === '阴红宇'
      ? await prisma.user.findUnique({ where: { id: yinhongyuId } })
      : await prisma.user.findFirst({ where: { username: name, role: 'bid_expert' } });
    if (!user) { console.warn(`  ⚠ 专家「${name}」User 不存在，跳过`); continue; }

    const exist = await prisma.bidExpert.findUnique({ where: { projectId_userId: { projectId: project.id, userId: user.id } } });
    if (exist) { console.log(`  · BidExpert「${name}」已存在，跳过`); continue; }

    await prisma.bidExpert.create({
      data: {
        projectId: project.id,
        userId: user.id,
        expertName: name,
        major: '地质/钻探',
        isLead: name === '阴红宇',
        expertRole: '正选',
        invitationStatus: 'pending',
        signedIn: true,
      },
    });
    console.log(`  + BidExpert「${name}」userId=${user.id}${name === '阴红宇' ? ' (isLead)' : ''}`);
  }
}
async function stepAi() {
  console.log('▶ ai: bootstrap Nest → ScorePointExtractorService 真实提取');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在');

  const app = await NestFactory.createApplicationContext(SeedYindajiminModule, { logger: ['error', 'warn'] });
  try {
    const extractor = app.get(ScorePointExtractorService);
    const items = await prisma.bidScoreItem.findMany({ where: { projectId: project.id } });

    for (const item of items) {
      if (item.category === 'PRICE') {
        await prisma.bidScorePoint.deleteMany({ where: { scoreItemId: item.id } });
        await prisma.bidScorePoint.create({ data: { scoreItemId: item.id, name: '评审价', fullScore: 50, seq: 0, evidenceHint: '最低价法：有效评审价由低到高排序' } });
        console.log('  + PRICE 手动得分点：评审价（50）');
        continue;
      }

      console.log(`  · 提取 ${item.category}（${item.name}）...`);
      let suggestions: { name: string; fullScore: number; evidenceHint?: string; objective?: boolean }[] = [];
      try {
        suggestions = await extractor.extractScorePoints(project.id, item.id);
      } catch (e) {
        console.warn(`  ⚠ ${item.category} 提取失败：${(e as Error).message}（回退：跳过）`);
      }
      if (suggestions.length === 0) {
        console.warn(`  ⚠ ${item.category} 提取返回空 — 保留既有得分点`);
        continue;
      }

      await prisma.bidScorePoint.deleteMany({ where: { scoreItemId: item.id } });
      for (const [idx, s] of suggestions.entries()) {
        await prisma.bidScorePoint.create({
          data: {
            scoreItemId: item.id,
            name: s.name,
            fullScore: Number(s.fullScore) || 0,
            seq: idx,
            evidenceHint: s.evidenceHint ?? null,
            objective: s.objective ?? true,
          },
        });
      }
      await prisma.bidScoreItem.update({ where: { id: item.id }, data: { criteriaSource: 'ai_inferred' } });
      console.log(`  + ${item.category}：${suggestions.length} 个得分点`);
    }
  } finally {
    await app.close();
  }
}
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
