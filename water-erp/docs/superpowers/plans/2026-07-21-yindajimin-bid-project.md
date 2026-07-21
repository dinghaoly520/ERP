# 引大济岷钻孔项目真实评审数据 + AI 评分要点提取 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实招标文件（引大济岷 ZK10/ZK12 钻孔）+ 三份真实投标 PDF，在水发 ERP 中创建一个可评审项目，真实跑通 AI 评分要点提取，推进到 EVALUATING 阶段。

**Architecture:** 一个幂等 TS 脚本 `apps/api/prisma/scripts/seed-yindajimin.ts`。阶段 A 用 `PrismaClient` 直连建结构化数据 + 入库 4 份文件；阶段 B `NestFactory.createApplicationContext(AppModule)` 拿 `ScorePointExtractorService` 真实调 DeepSeek 提取得分点；末尾置 `stage=EVALUATING`。脚本按 `--step=<name>` 分段，每步独立运行 + SQL 验证。非破坏性（不动现有 3 个项目）。

**Tech Stack:** NestJS 11 + Prisma 6 + tsx 4 + PostgreSQL 16 + MinIO + DeepSeek LLM + AES-256-GCM（`encryptBuffer`/`wrapKey`）+ bcryptjs。

## Global Constraints

- 不改 seed 主流程、不动现有 3 个项目；幂等（按 `projectCode='BID-2026-YDJM1'` 判存）
- 评分项分值固定：QUALIFICATION 0 / RESPONSIVE 0 / BUSINESS 20 / TECHNICAL 30 / PRICE 50（打分类 Σ=100）
- 资格/响应 pass/fail（`maxScore=0`）；`ScorePointExtractorService` 对 PRICE 自动跳过
- 投标文件**明文存** `sealedPath`（`sealedKey=null`，兼容 `fetchBidderPlaintext` 直读）
- 招标文件 **AES 加密**（`encryptBuffer` + `wrapKey(decryptKey, KMS_SECRET)`）
- 4 份文件硬编码路径在 `/home/asus/桌面/procurement/资料/标书及投标文件/`
- `KMS_SECRET` / `DEEPSEEK_API_KEY` 必须已在 `apps/api/.env` 配置
- 不主动 `git push`（只 commit）

## File Structure

- **Create** `apps/api/prisma/scripts/seed-yindajimin.ts` — 主脚本，按 step 组织函数
- **Modify** `apps/api/src/bid/bid.module.ts` — `exports` 数组加 `ScorePointExtractorService`（Task 6，一行）

---

## Task 0: 脚本骨架 + 共享常量 + step 调度

**Files:**
- Create: `apps/api/prisma/scripts/seed-yindajimin.ts`

**Interfaces:**
- Produces: 脚本入口 `main()`，解析 `--step` 参数；常量 `PROJECT_CODE`、`TENDER_DOCX`、`BID_PDFS`、`KMS`；占位 step 函数（后续 task 填充）。

- [ ] **Step 1: 写骨架文件**

写入 `apps/api/prisma/scripts/seed-yindajimin.ts`：

```ts
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
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

export const PROJECT_CODE = 'BID-2026-YDJM1';
export const KMS = process.env.KMS_SECRET;
if (!KMS) throw new Error('KMS_SECRET 未配置（apps/api/.env）');

const FILE_DIR = '/home/asus/桌面/procurement/资料/标书及投标文件';
export const TENDER_DOCX = `${FILE_DIR}/2026.1.27勘察分院-引大济岷工程千ZK10和千隧ZK12两个钻孔施工技术服务内部竞标（竞价）采购文件.docx`;
export const BID_PDFS: { name: string; path: string }[] = [
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
```

- [ ] **Step 2: 运行骨架确认可跑**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=basics`
Expected: 打印 `seed-yindajimin: step=basics` + `▶ basics（Task 1 填充）`，无报错退出。

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): 引大济岷项目脚本骨架 + step 调度"
```

---

## Task 1: 基础主体（Supplier ×3 + BidProject + Announcement）

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepBasics`）

**Interfaces:**
- Produces: `BidProject`（`projectCode=BID-2026-YDJM1`）、3 个 `Supplier`（name 见 `BID_PDFS`）、`Announcement`（id 后续 task 用 `relatedProjectCode` 反查）。

- [ ] **Step 1: 实现 stepBasics**

替换 `stepBasics` 函数为：

```ts
async function stepBasics() {
  console.log('▶ basics: Supplier ×3 + BidProject + Announcement');

  // ── 3 家 Supplier + User ──
  for (const s of BID_PDFS) {
    const existingUser = await prisma.user.findFirst({ where: { username: s.name } });
    if (existingUser) {
      const supp = await prisma.supplier.findUnique({ where: { userId: existingUser.id } });
      console.log(`  · Supplier「${s.name}」已存在，跳过 (userId=${existingUser.id})`);
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
```

- [ ] **Step 2: 运行 step=basics**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=basics`
Expected: 打印 3 个 `+ Supplier` + `+ BidProject` + `+ Announcement`，无报错。

- [ ] **Step 3: SQL 验证**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT (SELECT count(*) FROM \"Supplier\" WHERE \"normalizedName\" IN ('成都华建地质工程科技有限公司','四川省第十二地质大队','四川省第四地质大队')) AS suppliers,
       (SELECT stage FROM \"BidProject\" WHERE \"projectCode\"='BID-2026-YDJM1') AS stage,
       (SELECT type||'/'||status FROM \"Announcement\" WHERE \"relatedProjectCode\"='BID-2026-YDJM1') AS ann;"
```
Expected: `suppliers=3`, `stage=DOWNLOAD`, `ann=BID_NOTICE/PUBLISHED`。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=basics — Supplier×3 + BidProject + Announcement"
```

---

## Task 2: 招标文件入库（docx→pdf→加密→MinIO→BidDocument）

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepTender`）

**Interfaces:**
- Consumes: `Announcement.relatedProjectCode=BID-2026-YDJM1`（Task 1）、`encryptBuffer`（`../../src/announcement/bid-document.crypto`）、`wrapKey`（`../../src/common/crypto/envelope-crypto`）、`minioClient, MINIO_BUCKET`（`../../src/upload/minio.client`）。
- Produces: `FileAsset`（key=`yindajimin/tender.pdf`）+ `BidDocument`（decryptKey 已 wrap）。

- [ ] **Step 1: 顶部加 import**

在 `seed-yindajimin.ts` import 区追加（紧跟 `hashSync` 那行后）：

```ts
import { minioClient, MINIO_BUCKET } from '../../src/upload/minio.client';
import { encryptBuffer } from '../../src/announcement/bid-document.crypto';
import { wrapKey } from '../../src/common/crypto/envelope-crypto';
```

- [ ] **Step 2: 实现 stepTender**

替换 `stepTender` 函数为：

```ts
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

  // FileAsset（幂等：key 唯一，存在则更新）
  const asset = await prisma.fileAsset.upsert({
    where: { key: TENDER_KEY },
    create: { key: TENDER_KEY, originalName: '引大济岷钻孔项目招标文件.pdf', mimeType: 'application/pdf', size: plaintext.length, sha256: sha, category: 'tender', sealedPath: TENDER_KEY },
    update: { size: plaintext.length, sha256: sha, sealedPath: TENDER_KEY },
  });

  // AES 加密 + 上传密文
  const { ciphertext, decryptKey } = encryptBuffer(plaintext);
  await minioClient.putObject(MINIO_BUCKET, TENDER_KEY, ciphertext, ciphertext.length, { 'Content-Type': 'application/pdf' });
  const wrapped = wrapKey(decryptKey, KMS!);

  // BidDocument（幂等：announcementId 唯一）
  await prisma.bidDocument.upsert({
    where: { announcementId: ann.id },
    create: { announcementId: ann.id, fileAssetId: asset.id, title: '引大济岷钻孔项目招标文件', accessScope: 'OPEN', decryptKey: wrapped },
    update: { fileAssetId: asset.id, decryptKey: wrapped },
  });
  console.log(`  + BidDocument（announcementId=${ann.id}, asset=${asset.id}, decryptKey 已 wrap）`);
}
```

- [ ] **Step 3: 运行 step=tender**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=tender`
Expected: 打印招标 PDF 字节数 + `+ BidDocument`。libreoffice 首次启动较慢（~10–30s）。

- [ ] **Step 4: SQL 验证（含 fetchTenderPlaintext 可解密性，留待 Task 6 ai 步间接验证）**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT bd.title, bd.\"accessScope\", (bd.\"decryptKey\" IS NOT NULL) AS has_key, f.size, LEFT(f.sha256,12) AS sha
FROM \"BidDocument\" bd JOIN \"FileAsset\" f ON f.id=bd.\"fileAssetId\"
JOIN \"Announcement\" a ON a.id=bd.\"announcementId\" WHERE a.\"relatedProjectCode\"='BID-2026-YDJM1';"
```
Expected: 1 行，`has_key=t`，`size` 为 PDF 字节数，sha 非空。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=tender — 招标文件加密入库 BidDocument"
```

---

## Task 3: 投标供应商 + 投标 PDF 明文入库 + SupplierBidSubmission

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepBids`）

**Interfaces:**
- Consumes: Task 1 的 `BidProject`（按 projectCode）、3 个 `Supplier`（按 name）；`BID_PDFS` 常量。
- Produces: 3 个 `BidSupplier`（`decryptStatus=SUCCESS`）+ 3 个 `FileAsset`（投标 PDF，明文）+ 3 个 `SupplierBidSubmission`。

- [ ] **Step 1: 实现 stepBids**

替换 `stepBids` 函数为：

```ts
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
```

- [ ] **Step 2: 运行 step=bids**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=bids`
Expected: 3 行 `+ [n] <name> ... (字节 明文)`。51MB 文件 MinIO 上传略慢。

- [ ] **Step 3: SQL 验证**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT bs.\"supplierName\", bs.\"decryptStatus\", bs.\"submitStatus\", s.status AS sub_status,
       (s.\"technicalFileAssetId\" IS NOT NULL) AS has_file
FROM \"BidSupplier\" bs JOIN \"BidProject\" p ON p.id=bs.\"projectId\"
LEFT JOIN \"SupplierBidSubmission\" s ON s.\"projectId\"=p.id AND s.\"supplierId\"=bs.\"supplierId\"
WHERE p.\"projectCode\"='BID-2026-YDJM1' ORDER BY bs.\"supplierName\";"
```
Expected: 3 行，全部 `decryptStatus=SUCCESS`、`submitStatus=已提交`、`sub_status=submitted`、`has_file=t`。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=bids — 3 家投标供应商+PDF 明文入库+提交"
```

---

## Task 4: 开标 session + 5 个评分项

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepScore`）

**Interfaces:**
- Consumes: Task 1 的 `BidProject.id`。
- Produces: `BidOpeningSession`（projectId unique）、5 个 `BidScoreItem`（category/name/maxScore 见下表）。

- [ ] **Step 1: 实现 stepScore**

替换 `stepScore` 函数为：

```ts
async function stepScore() {
  console.log('▶ score: BidOpeningSession + 5 个 BidScoreItem');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在，请先跑 --step=basics');

  // BidOpeningSession（projectId unique）— 幂等
  await prisma.bidOpeningSession.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, host: '李主任', supervisor: '周老师', status: '已开标', decryptWindowStart: new Date('2026-07-25T02:00:00.000Z'), decryptWindowEnd: new Date('2026-07-25T06:00:00.000Z') },
    update: { status: '已开标' },
  });

  // 5 个 BidScoreItem（@@unique 无；按 projectId+category 幂等：先查后建）
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
```

- [ ] **Step 2: 运行 step=score**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=score`
Expected: `+ BidOpeningSession` 隐含 + 5 行 `+ BidScoreItem ...`。

- [ ] **Step 3: SQL 验证（Σ=100）**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT category, \"maxScore\" FROM \"BidScoreItem\" WHERE \"projectId\"=(SELECT id FROM \"BidProject\" WHERE \"projectCode\"='BID-2026-YDJM1') ORDER BY category;
SELECT 'TOTAL', COALESCE(sum(\"maxScore\"),0) FROM \"BidScoreItem\" WHERE \"projectId\"=(SELECT id FROM \"BidProject\" WHERE \"projectCode\"='BID-2026-YDJM1') AND category IN ('BUSINESS','TECHNICAL','PRICE');"
```
Expected: 5 行（QUALIFICATION 0 / RESPONSIVE 0 / BUSINESS 20 / TECHNICAL 30 / PRICE 50）；`TOTAL=100`。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=score — 开标session + 5 类评分项(Σ=100)"
```

---

## Task 5: 评审专家 ×6（含阴红宇 isLead）

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepExperts`）

**Interfaces:**
- Consumes: Task 1 的 `BidProject.id`；`User` 表（按 username 查专家 userId）。
- Produces: 6 个 `BidExpert`（@@unique [projectId, userId]）。

- [ ] **Step 1: 实现 stepExperts**

替换 `stepExperts` 函数为：

```ts
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
```

- [ ] **Step 2: 运行 step=experts**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=experts`
Expected: 6 行 `+ BidExpert`（阴红宇标 `(isLead)`）。

- [ ] **Step 3: SQL 验证**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT be.\"expertName\", be.\"isLead\", be.\"signedIn\" FROM \"BidExpert\" be
JOIN \"BidProject\" p ON p.id=be.\"projectId\" WHERE p.\"projectCode\"='BID-2026-YDJM1' ORDER BY be.\"isLead\" DESC;"
```
Expected: 6 行，阴红宇 `isLead=t`，其余 `isLead=f`，全部 `signedIn=t`。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=experts — 6 名评审专家(含阴红宇 isLead)"
```

---

## Task 6: bid.module 导出 + 真实跑 AI 评分要点提取

**Files:**
- Modify: `apps/api/src/bid/bid.module.ts`（exports 加一行）
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepAi`）

**Interfaces:**
- Consumes: `AppModule`（`../../src/app.module`）、`BidModule`、`ScorePointExtractorService`（`../../src/bid/score-point-extractor.service`）；Task 4 的 5 个 `BidScoreItem`（按 category）。
- Produces: `BidScorePoint` 若干（资格/响应/商务/技术各数项 + PRICE 手动 1 项）；4 类 `BidScoreItem.criteriaSource=ai_inferred`。

- [ ] **Step 1: bid.module 导出 ScorePointExtractorService**

修改 `apps/api/src/bid/bid.module.ts:25`，把 `exports` 数组改为：

```ts
  exports: [BidGateway, BidService, ClarificationAiService, ScorePointExtractorService],
```

- [ ] **Step 2: 顶部追加 Nest 相关 import**

在 `seed-yindajimin.ts` import 区追加：

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ScorePointExtractorService, ScorePointSuggestion } from '../../src/bid/score-point-extractor.service';
```

- [ ] **Step 3: 实现 stepAi**

替换 `stepAi` 函数为：

```ts
async function stepAi() {
  console.log('▶ ai: bootstrap Nest → ScorePointExtractorService 真实提取');
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) throw new Error('项目不存在');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const extractor = app.get(ScorePointExtractorService);
    const items = await prisma.bidScoreItem.findMany({ where: { projectId: project.id } });

    for (const item of items) {
      // PRICE 跳过（extractor 内部也会返回 []），手动建报价点
      if (item.category === 'PRICE') {
        await prisma.bidScorePoint.deleteMany({ where: { scoreItemId: item.id } });
        await prisma.bidScorePoint.create({ data: { scoreItemId: item.id, name: '评审价', fullScore: 50, seq: 0, evidenceHint: '最低价法：有效评审价由低到高排序' } });
        console.log('  + PRICE 手动得分点：评审价（50）');
        continue;
      }

      // 真实调 LLM 提取
      console.log(`  · 提取 ${item.category}（${item.name}）...`);
      let suggestions: ScorePointSuggestion[] = [];
      try {
        suggestions = await extractor.extractScorePoints(project.id, item.id);
      } catch (e) {
        console.warn(`  ⚠ ${item.category} 提取失败：${(e as Error).message}（回退：跳过，后续可手动补）`);
      }
      if (suggestions.length === 0) {
        console.warn(`  ⚠ ${item.category} 提取返回空（DeepSeek key? OCR?）—保留既有得分点`);
        continue;
      }

      // 落库（先清后建，保证幂等）
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
```

- [ ] **Step 4: 运行 step=ai（需 api 服务未占端口不影响；仅起 ApplicationContext，不监听 HTTP）**

前置确认：`apps/api/.env` 有 `DEEPSEEK_API_KEY`；OCR 微服务起着（`pnpm dev:ocr` 或已在跑）。
Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=ai`
Expected: 逐类打印 `提取 ...` → `+ <category>：N 个得分点`；PRICE 打印手动点。资格 ~6、响应 ~9、商务/技术 各若干。若某类返回空会打印 `⚠`。

- [ ] **Step 5: SQL 验证**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT i.category, i.\"criteriaSource\", count(p.id) AS points, string_agg(LEFT(p.name,20), ' | ') AS sample
FROM \"BidScoreItem\" i LEFT JOIN \"BidScorePoint\" p ON p.\"scoreItemId\"=i.id
WHERE i.\"projectId\"=(SELECT id FROM \"BidProject\" WHERE \"projectCode\"='BID-2026-YDJM1')
GROUP BY i.category, i.\"criteriaSource\" ORDER BY i.category;"
```
Expected: 5 行；资格/响应/商务/技术 `criteriaSource=ai_inferred` 且 points≥1；PRICE points=1（评审价）。

- [ ] **Step 6: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts water-erp/apps/api/src/bid/bid.module.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=ai — 真实跑 AI 评分要点提取(+export ScorePointExtractorService)"
```

---

## Task 7: 阶段推进 EVALUATING + 占位 AiBidAnalysisTask

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（填充 `stepAdvance`）

**Interfaces:**
- Consumes: 全部前置 task 产物；`BidSupervisionLog`、`AiBidAnalysisTask`（@@unique projectId）。
- Produces: `BidProject.stage=EVALUATING`、1 条 `BidSupervisionLog`、1 个 `AiBidAnalysisTask`（PENDING 占位）。

- [ ] **Step 1: 实现 stepAdvance（含前置校验）**

替换 `stepAdvance` 函数为：

```ts
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
```

- [ ] **Step 2: 运行 step=advance**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=advance`
Expected: 打印前置数值，然后 `+ stage=EVALUATING`。若前置不满足会抛错（提示哪个 task 需补）。

- [ ] **Step 3: SQL 验证**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT stage FROM \"BidProject\" WHERE \"projectCode\"='BID-2026-YDJM1';
SELECT status FROM \"AiBidAnalysisTask\" WHERE \"projectId\"=(SELECT id FROM \"BidProject\" WHERE \"projectCode\"='BID-2026-YDJM1');"
```
Expected: `stage=EVALUATING`；`status=PENDING`。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "feat(bid): step=advance — 前置校验后推进 EVALUATING"
```

---

## Task 8: 端到端验证 + 收尾

**Files:**
- 无新文件（仅运行 + 验证）

**Interfaces:**
- Consumes: Task 0–7 全部产物。

- [ ] **Step 1: 全流程重跑（验证幂等）**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && npx tsx prisma/scripts/seed-yindajimin.ts --step=all`
Expected: 各 step 打印 `· ... 已存在，跳过`（数据幂等）；AI 提取重跑会清旧点重建（正常）；最终 `stage=EVALUATING`。

- [ ] **Step 2: 综合验证 SQL**

Run:
```bash
docker exec -e PGPASSWORD=water_erp_dev water-erp-postgres psql -U water_erp -d water_erp -c "
SELECT p.stage, p.name,
  (SELECT count(*) FROM \"BidExpert\" be WHERE be.\"projectId\"=p.id) AS experts,
  (SELECT count(*) FROM \"BidSupplier\" bs WHERE bs.\"projectId\"=p.id AND bs.\"decryptStatus\"='SUCCESS') AS suppliers,
  (SELECT count(*) FROM \"BidScorePoint\" pt JOIN \"BidScoreItem\" si ON si.id=pt.\"scoreItemId\" WHERE si.\"projectId\"=p.id) AS score_points
FROM \"BidProject\" p WHERE p.\"projectCode\"='BID-2026-YDJM1';"
```
Expected: `stage=EVALUATING`，experts=6，suppliers=3，score_points≥12（资格6+响应9+商务≥1+技术≥1+价格1）。

- [ ] **Step 3: 专家门户登录验证（人工）**

用 `阴红宇` / `expert@2026` 登录专家门户（:3006），确认项目列表能看到「引大济岷工程…钻孔施工技术服务」，点进去能看到评分标准（5 类 + 各类得分点，资格/响应为检查项）。

- [ ] **Step 4: 回退说明（写进脚本顶部注释或 README）**

若 AI 提取某类返回空（DeepSeek/OCR 故障），可手动补：直接 `INSERT INTO "BidScorePoint"`（参考 spec §5.6 的检查项清单）。

- [ ] **Step 5: 最终 commit（若有注释微调）**

```bash
git -C /home/asus/桌面/ERP add -A water-erp/apps/api/prisma/scripts/seed-yindajimin.ts
git -C /home/asus/桌面/ERP commit -m "chore(bid): 引大济岷脚本收尾注释"
```

---

## 执行备注

- **运行环境前置**：`pnpm infra:up`（PG/Redis/MinIO）+ `pnpm db:migrate` + `.env`（`KMS_SECRET`/`DEEPSEEK_API_KEY`）+ OCR 微服务（`pnpm dev:ocr`，:8100）。
- **首次 libreoffice 转 pdf** 较慢（~10–30s），后续有缓存。
- **51MB 投标 PDF**：MinIO 上传 + 后续 OCR 解析较慢，属正常。
- **AI 提取耗时**：4 次 DeepSeek 调用，约 30–90s。
- **不 push**：所有 commit 留本地，由用户决定何时 push。
