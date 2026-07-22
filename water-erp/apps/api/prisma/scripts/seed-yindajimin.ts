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
  // AI_SCORE_CATEGORIES 控制哪些类走 AI（默认仅 TECHNICAL；模型升级后可加 QUALIFICATION,RESPONSIVE,BUSINESS）
  const aiCategories = (process.env.AI_SCORE_CATEGORIES ?? 'TECHNICAL').split(',').map((s) => s.trim());
  console.log(`  AI 提取类别：${aiCategories.join(', ') || '（无，全手动）'}`);
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
      // QUALIFICATION 资格性审查：LLM 对该 pass/fail 类易与符合性审查串混（实测 8 项里 6 项跑偏），
      // 直接按招标文件「资格审查要求」表手动落库 6 项（稳定、准确），criteriaSource=manual。
      if (item.category === 'QUALIFICATION' && !aiCategories.includes('QUALIFICATION')) {
        await prisma.bidScorePoint.deleteMany({ where: { scoreItemId: item.id } });
        const qualPoints = [
          { name: '有效营业执照/事业单位法人证书', hint: '企业提供营业执照、事业单位提供法人证书等证明文件' },
          { name: '供应商资格声明书', hint: '提供符合采购文件要求的《供应商资格声明书》' },
          { name: '具有独立法人资格', hint: '供应商须具有独立法人资格' },
          { name: '工程钻探劳务资质或地勘红名单', hint: '具备工程钻探劳务资质，或在中国矿业联合会地质勘查信用信息公示系统红名单内' },
          { name: '近5年内≥2项500米及以上钻孔业绩', hint: '近5年内至少两项500米及以上水平/倾斜钻孔施工业绩，附中标通知书或合同关键页' },
          { name: '联合体资格要求', hint: '本项目是否接受联合体及联合体各方资格分工要求' },
        ];
        for (const [idx, p] of qualPoints.entries()) {
          await prisma.bidScorePoint.create({ data: { scoreItemId: item.id, name: p.name, fullScore: 0, seq: idx, evidenceHint: p.hint, objective: true } });
        }
        await prisma.bidScoreItem.update({ where: { id: item.id }, data: { criteriaSource: 'manual' } });
        console.log(`  + QUALIFICATION 手动建 ${qualPoints.length} 个资格审查项`);
        continue;
      }
      // RESPONSIVE 符合性审查：LLM 对该 pass/fail 类提取极不稳（实测恒 0/1），
      // 直接按招标文件「符合性审查要求」表手动落库 9 项（稳定、准确），criteriaSource=manual。
      if (item.category === 'RESPONSIVE' && !aiCategories.includes('RESPONSIVE')) {
        await prisma.bidScorePoint.deleteMany({ where: { scoreItemId: item.id } });
        const respPoints = [
          { name: '授权委托书有效', hint: '按采购文件要求提供授权委托书' },
          { name: '投标保证金缴纳', hint: '按采购文件规定提交保证金（如有）' },
          { name: '响应完整性（未拆分）', hint: '未将一个标的内容拆分响应' },
          { name: '报价未超最高限价', hint: '报价未超过采购文件规定的最高限价' },
          { name: '报价唯一性', hint: '响应文件未出现可选择性或可调整报价' },
          { name: '响应有效期满足', hint: '响应文件承诺的有效期满足采购文件要求' },
          { name: '实质性格式文件齐全', hint: '标记为实质性格式的文件均按要求提供' },
          { name: '★号实质性条款响应', hint: '响应文件满足第四章采购需求中★号条款要求' },
          { name: '报价合理性', hint: '报价合理，或明显低价时能在规定时间证明合理性' },
        ];
        for (const [idx, p] of respPoints.entries()) {
          await prisma.bidScorePoint.create({ data: { scoreItemId: item.id, name: p.name, fullScore: 0, seq: idx, evidenceHint: p.hint, objective: true } });
        }
        await prisma.bidScoreItem.update({ where: { id: item.id }, data: { criteriaSource: 'manual' } });
        console.log(`  + RESPONSIVE 手动建 ${respPoints.length} 个符合性审查项`);
        continue;
      }
      // BUSINESS 商务评分：LLM 提取偏少（实测 1-2 项，漏付款/农民工/交付），
      // 手动补全 5 项商务段原文条款，Σ=20，criteriaSource=manual。
      if (item.category === 'BUSINESS' && !aiCategories.includes('BUSINESS')) {
        await prisma.bidScorePoint.deleteMany({ where: { scoreItemId: item.id } });
        const bizPoints = [
          { name: '交付期限响应', fullScore: 6, hint: '2026年4月10日前完成钻孔取心钻探及配合试验等工作' },
          { name: '付款方式响应', fullScore: 5, hint: '响应合同价款分阶段支付方式（预付10%/进场20%/达深30%/验收尾款）' },
          { name: '农民工工资支付保障', fullScore: 4, hint: '针对农民工工资支付的具体承诺（见合同附件）' },
          { name: '保险购买承诺', fullScore: 3, hint: '为投入的机械设备和人员购买足额保险' },
          { name: '包装运输', fullScore: 2, hint: '包装和运输要求（本项目无特殊要求）' },
        ];
        for (const [idx, p] of bizPoints.entries()) {
          await prisma.bidScorePoint.create({ data: { scoreItemId: item.id, name: p.name, fullScore: p.fullScore, seq: idx, evidenceHint: p.hint, objective: true } });
        }
        await prisma.bidScoreItem.update({ where: { id: item.id }, data: { criteriaSource: 'manual' } });
        console.log(`  + BUSINESS 手动建 ${bizPoints.length} 个商务评分项（Σ20）`);
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
async function stepAdvance() {
  console.log('▶ advance: 校验前置 → stage=EVALUATING');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在');

  // 前置校验（与 bid.service.startEvaluation 对齐）
  const expertCount = await prisma.bidExpert.count({ where: { projectId: project.id } });
  const evaluableCount = await prisma.bidSupplier.count({ where: { projectId: project.id, decryptStatus: 'SUCCESS', submitStatus: { not: '已撤回' } } });
  const scoringItems = await prisma.bidScoreItem.findMany({ where: { projectId: project.id, category: { in: ['BUSINESS', 'TECHNICAL', 'PRICE'] } }, include: { points: true } });
  const sumScore = scoringItems.reduce((s, i) => s + Number(i.maxScore), 0);
  const eachHasPoint = scoringItems.every((i) => i.points.length >= 1);
  console.log(`  · 前置：experts=${expertCount}（需≥1）evaluableSuppliers=${evaluableCount}（需≥1）打分Σ=${sumScore}（需100）每项有点=${eachHasPoint}`);
  if (expertCount === 0 || evaluableCount === 0 || sumScore !== 100 || !eachHasPoint) {
    throw new Error('前置不满足，无法推进 EVALUATING（检查前置 task 是否跑全 + AI 提取是否有得分点）');
  }

  await prisma.bidProject.update({ where: { id: project.id }, data: { stage: 'EVALUATING' } });
  await prisma.bidSupervisionLog.create({
    data: { projectId: project.id, time: new Date(), role: '系统', target: project.name, action: '启动评标 (OPENING→EVALUATING)', result: '阶段变更成功', riskFlag: '无' },
  });
  await prisma.aiBidAnalysisTask.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, status: 'PENDING' },
    update: {},
  });
  console.log('  + stage=EVALUATING（supervision log + 占位 AiBidAnalysisTask）');
}

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
