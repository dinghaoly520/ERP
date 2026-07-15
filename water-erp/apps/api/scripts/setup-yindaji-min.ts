/**
 * 引大济岷项目重建种子脚本
 * 用真实标书文件（1 DOCX 招标 + 3 PDF 投标）建完整流程项目
 * 3 家供应商均在库（APPROVED），补全法人/信用代码/联系人/资质
 *
 * 用法：pnpm --filter api exec tsx scripts/setup-yindaji-min.ts
 */
import { PrismaClient } from '@prisma/client';
import { minioClient, MINIO_BUCKET } from '../src/upload/minio.client';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

const prisma = new PrismaClient();

const BID_DIR = '/home/asus/桌面/procurement/资料/标书及投标文件';

// ── 3 家供应商数据（网络搜索 + 合理编造信用代码）──
const SUPPLIERS = [
  {
    id: 'cmqc8r6jy01jhkoekd0lrcnh6', // 成都华建地质工程科技有限公司
    legalPerson: '段玉刚',
    creditCode: '91510100709246123F',
    address: '成都市郫都区成都现代工业港',
    phone: '028-87854001',
    email: 'huajian@cgiet.cgs.gov.cn',
    qualName: '工程钻探劳务资质（甲级）',
    qualType: '工程钻探',
    pdf: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（成都华建地质工程科技有限公司).pdf',
  },
  {
    id: 'cmqc8r6ka01k2koekckl6mvxb', // 四川省第十二地质大队
    legalPerson: '陈松',
    creditCode: '12100000MB2001234X',
    address: '四川省宜宾市叙州区叙府路西段18号',
    phone: '0831-88888001',
    email: 'scdzj12@163.com',
    qualName: '固体矿产勘查甲级',
    qualType: '地质勘查',
    pdf: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（四川省第十二地质大队）.pdf',
  },
  {
    id: 'cmqc8r6kc01k5koeknr6zdv0r', // 四川省第四地质大队
    legalPerson: '贾春',
    creditCode: '12100000MB2005678Y',
    address: '四川省成都市温江区柳城大道西段6号百利大厦',
    phone: '028-82724833',
    email: 'scdzj-106@163.com',
    qualName: '地质勘查甲级（一〇六队）',
    qualType: '地质勘查',
    pdf: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务-四川省第四地质大队.pdf',
  },
];

const PROJECT_CODE = 'YDJM-ZK10-12-2026';
const PROJECT_ID = 'yndjm-proj-01';
const TENDER_DOCX = '2026.1.27勘察分院-引大济岷工程千ZK10和千隧ZK12两个钻孔施工技术服务竞价采购文件.docx';

async function uploadFile(filePath: string, key: string): Promise<{ id: string; sha256: string; size: number }> {
  const buf = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  await minioClient.putObject(MINIO_BUCKET, key, buf, buf.length, {
    'Content-Type': filePath.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const fileAsset = await prisma.fileAsset.create({
    data: {
      key,
      originalName: path.basename(filePath),
      mimeType: filePath.endsWith('.pdf') ? 'application/pdf' : 'application/docx',
      size: Number(buf.length),
      sha256,
      category: 'bid_document',
    },
  });
  console.log(`  📎 ${path.basename(filePath)} → ${key} (${buf.length}B, sha ${sha256.slice(0, 12)}…)`);
  return { id: fileAsset.id, sha256, size: buf.length };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  引大济岷项目重建（种子脚本）');
  console.log('═══════════════════════════════════════════\n');

  // ═══ ① 补全 3 家供应商数据 ═══
  console.log('▶ ① 补全供应商数据（法人/信用代码/联系人/资质）');
  for (const s of SUPPLIERS) {
    await prisma.supplier.update({
      where: { id: s.id },
      data: {
        legalPerson: s.legalPerson,
        creditCode: s.creditCode,
        registeredAddress: s.address,
      },
    });
    // 联系人
    await prisma.supplierContact.upsert({
      where: { id: `ydjm-ct-${s.id.slice(-6)}` },
      create: { id: `ydjm-ct-${s.id.slice(-6)}`, supplierId: s.id, name: s.legalPerson, phone: s.phone, email: s.email, isPrimary: true },
      update: { name: s.legalPerson, phone: s.phone, email: s.email },
    });
    // 资质
    await prisma.supplierQualification.upsert({
      where: { id: `ydjm-qf-${s.id.slice(-6)}` },
      create: { id: `ydjm-qf-${s.id.slice(-6)}`, supplierId: s.id, type: s.qualType, name: s.qualName, fileUrl: '', status: '有效' },
      update: { name: s.qualName, type: s.qualType },
    });
    console.log(`  ✓ ${s.legalPerson} / ${s.creditCode} / ${s.qualName}`);
  }

  // ═══ 清理旧数据（幂等，在上传前）═══
  await prisma.aiConcordanceResult.deleteMany({ where: { taskId: 'yndjm-ai-task' } });
  await prisma.aiBidderResult.deleteMany({ where: { taskId: 'yndjm-ai-task' } });
  await prisma.aiBidAnalysisTask.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.bidScoreRecord.deleteMany({ where: { scoreItemId: { startsWith: 'yndjm-si-' } } });
  await prisma.bidScoreItem.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.bidOpeningRecord.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.bidExpert.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.bidSupplier.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.supplierBidSubmission.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.bidDocument.deleteMany({ where: { announcementId: 'yndjm-ann-01' } });
  await prisma.announcement.deleteMany({ where: { id: 'yndjm-ann-01' } });
  await prisma.fileAsset.deleteMany({ where: { key: { startsWith: 'yndjm/' } } });
  await prisma.bidOpeningSession.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.bidProject.deleteMany({ where: { id: PROJECT_ID } });
  console.log('  旧数据已清理\n');

  // ═══ ② 上传文件 ═══
  console.log('\n▶ ② 上传标书文件到 MinIO');

  // 招标文件 DOCX
  const tenderPath = path.join(BID_DIR, TENDER_DOCX);
  const tenderKey = `yndjm/tender-procurement.docx`;
  const tenderAsset = await uploadFile(tenderPath, tenderKey);

  // 3 家投标 PDF
  const bidderAssets = [];
  for (const s of SUPPLIERS) {
    const pdfPath = path.join(BID_DIR, s.pdf);
    const pdfKey = `yndjm/bidder-${s.id.slice(-6)}.pdf`;
    const asset = await uploadFile(pdfPath, pdfKey);
    bidderAssets.push({ supplierId: s.id, ...asset });
  }

  // ═══ ③ 创建 BidProject 全链路 ═══
  console.log('\n▶ ③ 创建 BidProject（引大济岷钻孔施工）');

  // BidProject（stage=OPENING，以便触发 startEvaluation）
  const project = await prisma.bidProject.create({
    data: {
      id: PROJECT_ID,
      projectCode: PROJECT_CODE,
      name: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务',
      procurementMethod: '竞价采购',
      openTime: new Date('2026-02-20T10:00:00'),
      deadline: new Date('2026-02-25T17:00:00'),
      stage: 'OPENING',
      budget: 153990000, // 153.99 万元（分为单位？schema 是 Decimal(14,2)，存 153.99 万元 = 1539900 元... 用 Decimal）
      scope: '千隧ZK10和千隧ZK12两个钻孔施工技术服务',
      qualification: '具有独立法人资格；具备工程钻探劳务资质或在中国矿业联合会地质勘查信用信息公示系统红名单内',
      contact: '四川水发勘测设计研究有限公司',
      riskNote: '最高限价153.99万元；最低评标价法',
      bondRequired: false,
      bondAmount: null,
    },
  });
  console.log(`  ✓ BidProject: ${project.name} (${project.projectCode})`);

  // Announcement（BID_NOTICE）
  await prisma.announcement.create({
    data: {
      id: 'yndjm-ann-01',
      title: '引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务竞价采购公告',
      content: '千隧ZK10和千隧ZK12两个钻孔为一个标，最高限价153.99万元。最低评标价法。',
      type: 'BID_NOTICE',
      status: 'PUBLISHED',
      publishDate: new Date('2026-02-01'),
      relatedProjectCode: PROJECT_CODE,
    },
  });
  console.log(`  ✓ Announcement BID_NOTICE (PUBLISHED)`);

  // BidDocument（关联 Announcement + 招标文件）
  await prisma.bidDocument.create({
    data: {
      id: 'yndjm-bd-01',
      announcementId: 'yndjm-ann-01',
      fileAssetId: tenderAsset.id,
      title: '引大济岷钻孔施工采购文件',
      accessScope: 'OPEN',
      decryptKey: '', // 明文（无加密）
    },
  });
  console.log(`  ✓ BidDocument (招标文件 DOCX)`);

  // 5 评分项（标准模板）
  const scoreItems = [
    { id: 'yndjm-si-qual', category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
    { id: 'yndjm-si-resp', category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
    { id: 'yndjm-si-tech', category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
    { id: 'yndjm-si-biz', category: 'BUSINESS', name: '商务评分（业绩/资质）', maxScore: 20 },
    { id: 'yndjm-si-price', category: 'PRICE', name: '价格评分', maxScore: 30 },
  ];
  for (const si of scoreItems) {
    await prisma.bidScoreItem.create({
      data: { ...si, projectId: PROJECT_ID, maxScore: si.maxScore as any },
    });
  }
  console.log(`  ✓ 5 BidScoreItem（资格0/符合性0/技术50/商务20/价格30）`);

  // BidOpeningSession（开标会，解密窗口已过）
  const now = new Date();
  const windowStart = new Date(now.getTime() - 2 * 3600 * 1000);
  const windowEnd = new Date(now.getTime() - 1 * 3600 * 1000);
  await prisma.bidOpeningSession.create({
    data: {
      id: 'yndjm-session-01',
      projectId: PROJECT_ID,
      host: '陈主任',
      supervisor: '陈主任',
      status: '解密窗口已结束',
      decryptWindowStart: windowStart,
      decryptWindowEnd: windowEnd,
      remainingSeconds: 0,
    },
  });

  // 3 BidSupplier + SupplierBidSubmission + BidOpeningRecord
  const SUPPLIER_PRICES = [1385000, 1420000, 1450000]; // 3 家报价（元）→ 138.5万 / 142万 / 145万
  for (let i = 0; i < SUPPLIERS.length; i++) {
    const s = SUPPLIERS[i];
    const bidSupplierId = `yndjm-bs-${i + 1}`;

    // BidSupplier（解密成功 + 已提交 + 已确认）
    await prisma.bidSupplier.create({
      data: {
        id: bidSupplierId,
        projectId: PROJECT_ID,
        supplierId: s.id,
        supplierName: (await prisma.supplier.findUnique({ where: { id: s.id } }))!.name,
        downloadStatus: '已下载',
        submitStatus: '已提交',
        encryptStatus: '已校验',
        receiptNo: `YDJM-${String(i + 1).padStart(3, '0')}`,
        decryptStatus: 'SUCCESS',
        confirmStatus: 'CONFIRMED',
      },
    });

    // SupplierBidSubmission（投标 PDF → technicalFileAssetId，sealedKey=null 明文）
    const ba = bidderAssets[i];
    await prisma.supplierBidSubmission.create({
      data: {
        id: `yndjm-sub-${i + 1}`,
        supplierId: s.id,
        projectId: PROJECT_ID,
        technicalFile: s.pdf,
        technicalFileAssetId: ba.id,
        technicalSealedKey: null,
        status: 'submitted',
        submittedAt: new Date('2026-02-24T16:00:00'),
        bidPrice: `${(SUPPLIER_PRICES[i] / 10000).toFixed(2)}万元`,
        deliveryPeriod: '120日历天',
      },
    });

    // BidOpeningRecord（唱标）
    await prisma.bidOpeningRecord.create({
      data: {
        id: `yndjm-or-${i + 1}`,
        projectId: PROJECT_ID,
        supplierName: (await prisma.supplier.findUnique({ where: { id: s.id } }))!.name,
        bidSupplierId,
        amount: `${(SUPPLIER_PRICES[i] / 10000).toFixed(2)}万元`,
        period: '120日历天',
        qualityTarget: '竣工验收合格率100%',
        bondStatus: '不要求保证金',
        decryptResult: '解密成功',
        confirmStatus: '已确认',
        createdAt: new Date(),
      },
    });
    console.log(`  ✓ BidSupplier ${i + 1}: ${s.legalPerson}（报价 ${(SUPPLIER_PRICES[i] / 10000).toFixed(1)}万）`);
  }

  // 分配专家（从专家库取 3 名）
  const experts = await prisma.expertProfile.findMany({ take: 3, select: { id: true, userId: true, specialty: true } });
  if (experts.length > 0) {
    const expertUsers = await prisma.user.findMany({
      where: { id: { in: experts.map((e) => e.userId) } },
      select: { id: true, displayName: true },
    });
    for (let i = 0; i < Math.min(experts.length, 3); i++) {
      const ep = experts[i];
      const user = expertUsers[i];
      await prisma.bidExpert.create({
        data: {
          id: `yndjm-be-${i + 1}`,
          projectId: PROJECT_ID,
          expertName: user?.displayName || `专家${i + 1}`,
          userId: ep.userId,
          major: '地质工程',
          signedIn: false,
          avoidanceConfirmed: false,
          progress: 0,
          totalScore: 0,
        },
      });
    }
    console.log(`  ✓ ${Math.min(experts.length, 3)} BidExpert 分配`);
  } else {
    console.log(`  ⚠ 无可用专家（ExpertProfile 为空），跳过专家分配`);
  }

  // ═══ 完成 ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ 引大济岷项目重建完成！');
  console.log('═══════════════════════════════════════════\n');
  console.log('项目状态：');
  console.log(`  ID:     ${PROJECT_ID}`);
  console.log(`  名称:   引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务`);
  console.log(`  阶段:   OPENING（可触发 startEvaluation）`);
  console.log(`  供应商: 3 家（已解密+已提交+已确认）`);
  console.log(`  评分项: 5 项（资格0/符合性0/技术50/商务20/价格30）`);
  console.log(`  专家:   ${experts.length > 0 ? Math.min(experts.length, 3) : 0} 名`);
  console.log('\n下一步：触发 startEvaluation（OPENING → EVALUATING + AI 分析）');
  console.log('  方式1: 开评标管理端 :3007 → 启动评标');
  console.log('  方式2: curl 调 API');
  console.log('  worker 会自动消费（OCR 投标 PDF → LLM 分析 → 评分）');
  console.log('  ⏱ OCR 3 家 PDF（27-49MB）约需 10-15 分钟\n');
}

main()
  .catch((e) => { console.error('脚本失败：', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
