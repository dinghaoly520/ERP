/**
 * 创建可投标项目 — 独立种子脚本
 *
 * 在供应商门户"招标机会"页面（/bids）生成一个完整的、处于 DOWNLOAD 阶段的
 * 可投标项目，包含：
 *   - BidProject（公开招标，文件下载期）
 *   - Announcement（BID_NOTICE 招标公告，已发布）
 *   - BidDocument（真实文件 → AES-256-GCM 加密 → MinIO）
 *   - BidSupplier（关联已有 approved 供应商）
 *   - BidDocumentAccess（供应商标书下载权限）
 *
 * 运行方式：
 *   cd water-erp/apps/api
 *   npx ts-node prisma/scripts/create-bidable-project.ts
 *
 * 幂等性：重复运行会先清理同一 projectCode 的旧数据再重建。
 */

import { PrismaClient } from '@prisma/client';
import { encryptBuffer } from '../../src/announcement/bid-document.crypto';
import {
  minioClient,
  MINIO_BUCKET,
  ensureBucket,
} from '../../src/upload/minio.client';
import * as crypto from 'crypto';
import * as path from 'path';

// ─── 环境变量 ────────────────────────────────────────────────
// 尝试加载 .env（兼容有无 dotenv 两种情况）
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  const envPaths = [
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '.env.local'),
  ];
  for (const p of envPaths) {
    dotenv.config({ path: p });
  }
} catch {
  // dotenv 不可用 — 依赖 shell 环境或 docker-compose 注入
}

// ─── 常量 ────────────────────────────────────────────────────

const PROJECT_CODE = 'BID-2026-0618';
const PROJECT_NAME = '2026年度水利信息化平台升级改造项目';
const UPLOADER_ID = 'cmqbysdbl0002koh10l78cjr3'; // caigou (procurement_staff)

/** 参与投标的两个已批准供应商 */
const SUPPLIERS = [
  {
    id: 'cmqbysdkb001lkoh1lif07y1g',
    name: '四川川水建设工程有限公司',
  },
  {
    id: 'cmqbysdm50029koh18g2n7p54',
    name: '成都华西物资供应有限公司',
  },
];

// ─── Prisma 客户端 ──────────────────────────────────────────

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

// ─── 工具函数 ────────────────────────────────────────────────

/** 生成 16 字符随机 hex */
function randomHex(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * 生成一份真实的招标文件（纯文本，UTF-8）。
 * 内容参照实际招标文件结构编写。
 */
function generateBidDocumentBuffer(): Buffer {
  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '        四川水发集团·蜀水云采电子招标采购平台',
    '                     招  标  文  件',
    '═══════════════════════════════════════════════════════════════',
    '',
    `项目名称：${PROJECT_NAME}`,
    `项目编号：${PROJECT_CODE}`,
    '采购方式：公开招标',
    '',
    '───────────────────────────────────────────────────────────────',
    '                     第一章  招标公告',
    '───────────────────────────────────────────────────────────────',
    '',
    '1. 招标条件',
    `   本招标项目 ${PROJECT_NAME} 已由四川水发集团批准建设，`,
    '   项目业主为四川水发投资有限公司，建设资金来自企业自筹及财政补助，',
    '   出资比例为 100%。项目已具备招标条件，现对该项目进行公开招标。',
    '',
    '2. 项目概况与招标范围',
    '   2.1 建设地点：成都市高新区天府大道北段 1700 号（集团数据中心）',
    '             及下属 5 个分中心（绵阳、南充、宜宾、达州、凉山）。',
    '   2.2 建设规模：数据中台扩容 200TB、业务系统迁移 12 套、',
    '             智能调度模块开发 1 套、统一身份认证平台 1 套、',
    '             移动端适配（iOS/Android/小程序）。',
    '   2.3 预算金额：人民币 680 万元（含税）。',
    '   2.4 工期要求：180 日历天（自合同签订之日起计算）。',
    '   2.5 质量要求：符合《水利信息化建设技术规范》（SL 588-2024），',
    '             一次性验收合格。',
    '   2.6 标段划分：本项目不分标段。',
    '',
    '3. 投标人资格要求',
    '   3.1 在中华人民共和国境内依法注册，具有独立法人资格。',
    '   3.2 具备电子与智能化工程专业承包二级及以上资质。',
    '   3.3 近三年（2023-2026）至少完成 2 个合同金额不低于 500 万元',
    '       的水利或水务信息化类似项目业绩（提供合同及验收报告）。',
    '   3.4 拟派项目经理须具备信息系统项目管理师（高级）证书，',
    '       且在投标单位连续缴纳社保不少于 12 个月。',
    '   3.5 具有良好的商业信誉和健全的财务会计制度，近三年无重大',
    '       违法记录，未被列入失信被执行人名单。',
    '   3.6 本项目不接受联合体投标。',
    '',
    '───────────────────────────────────────────────────────────────',
    '                     第二章  投标人须知',
    '───────────────────────────────────────────────────────────────',
    '',
    '4. 招标文件的获取',
    '   4.1 凡有意参加投标者，请通过蜀水云采平台供应商门户',
    '       （https://eps.scsdjt.com）完成注册并下载电子招标文件。',
    '   4.2 招标文件免费提供，不收取任何费用。',
    '   4.3 下载期限：自本公告发布之日起至投标截止时间止。',
    '',
    '5. 投标文件的递交',
    '   5.1 投标文件递交的截止时间（投标截止时间）为：',
    '       2026 年 7 月 15 日 17 时 00 分（北京时间）。',
    '   5.2 投标人应在截止时间前通过蜀水云采平台在线提交加密投标文件。',
    '   5.3 逾期提交的投标文件，电子招标投标交易平台将予以拒收。',
    '   5.4 投标文件应包括：',
    '       (1) 技术方案文件（含系统架构、技术路线、实施方案等）；',
    '       (2) 商务报价文件（含分项报价、税费明细等）；',
    '       (3) 投标函及承诺书（含投标函、诚信承诺书、保密承诺书等）。',
    '',
    '6. 开标时间及地点',
    '   6.1 开标时间：2026 年 7 月 16 日 10 时 00 分（北京时间）。',
    '   6.2 开标方式：在线开标（蜀水云采平台开标大厅）。',
    '   6.3 投标人应在开标时间前登录平台，参与在线解密及开标确认。',
    '',
    '7. 踏勘现场',
    '   7.1 招标人不统一组织踏勘现场，投标人可自行前往。',
    '   7.2 踏勘联系人：信息技术部张工，电话 028-88888001。',
    '',
    '8. 发布公告的媒介',
    '   本次招标公告在蜀水云采电子招标采购平台发布。',
    '',
    '───────────────────────────────────────────────────────────────',
    '                   第三章  技术规格与要求',
    '───────────────────────────────────────────────────────────────',
    '',
    '9. 总体技术要求',
    '   9.1 系统采用微服务架构，基于 Spring Cloud Alibaba 技术栈。',
    '   9.2 数据中台采用 Apache Hadoop + Spark + Flink 生态。',
    '   9.3 前端采用 React 18 + TypeScript，支持响应式布局。',
    '   9.4 数据库采用 PostgreSQL 16 + Redis 7 集群。',
    '   9.5 文件存储采用 MinIO 分布式对象存储。',
    '   9.6 系统须满足等保 2.0 三级要求，通过第三方安全测评。',
    '',
    '10. 功能模块要求',
    '   10.1 数据中台：数据采集、清洗、建模、服务化全链路。',
    '   10.2 智能调度：基于 AI 的水资源调度优化算法。',
    '   10.3 统一认证：OAuth 2.0 + OIDC，支持 SSO 单点登录。',
    '   10.4 运维监控：Prometheus + Grafana 全链路监控。',
    '',
    '───────────────────────────────────────────────────────────────',
    '                    第四章  评标办法',
    '───────────────────────────────────────────────────────────────',
    '',
    '11. 评标方法：综合评估法。',
    '',
    '12. 评分项目及权重：',
    '    ┌────────────┬──────┬──────────────────────────┐',
    '    │  评分项目   │ 权重  │        评分要点           │',
    '    ├────────────┼──────┼──────────────────────────┤',
    '    │ 资格性审查  │  合格 │ 资质、业绩、信用、财务    │',
    '    │ 符合性审查  │  合格 │ 响应完整性、格式合规      │',
    '    │ 商务评分    │  20% │ 报价合理性、付款条件      │',
    '    │ 技术评分    │  50% │ 方案先进性、实施可行性    │',
    '    │ 价格评分    │  30% │ 价格竞争力（低价优先）    │',
    '    └────────────┴──────┴──────────────────────────┘',
    '',
    '───────────────────────────────────────────────────────────────',
    '                    第五章  合同条款（草案）',
    '───────────────────────────────────────────────────────────────',
    '',
    '13. 付款方式：',
    '    13.1 合同签订后 30 日内支付合同总价的 30% 作为预付款；',
    '    13.2 系统上线并初验合格后支付合同总价的 40%；',
    '    13.3 终验合格后支付合同总价的 25%；',
    '    13.4 质保期满（验收合格之日起 2 年）后支付剩余 5%。',
    '',
    '14. 质保及售后服务：',
    '    14.1 质保期：自终验合格之日起 24 个月。',
    '    14.2 故障响应：7×24 小时，一般故障 4 小时内解决，',
    '        重大故障 2 小时内到场。',
    '    14.3 质保期内免费提供系统升级、安全补丁和技术支持。',
    '',
    '15. 知识产权：',
    '    本项目产生的全部知识产权归招标人所有。',
    '',
    '───────────────────────────────────────────────────────────────',
    '',
    '                    采购中心联系人信息',
    '',
    '    联 系 人：信息技术部  张工',
    '    联系电话：028-88888001',
    '    电子邮箱：zhanggong@scsdjt.com',
    '    联系地址：成都市高新区天府大道北段 1700 号',
    '',
    '                    四川水发投资有限公司',
    '                    2026 年 6 月 17 日',
    '',
    '═══════════════════════════════════════════════════════════════',
    '           本文件为电子招标文件，与纸质文件具有同等法律效力',
    '═══════════════════════════════════════════════════════════════',
  ];

  return Buffer.from(lines.join('\n'), 'utf-8');
}

// ─── 清理函数 ────────────────────────────────────────────────

/**
 * 删除已存在的同 projectCode 数据（幂等性保证）。
 * 按外键依赖逆序删除，同时清除 MinIO 存储对象。
 */
async function cleanup(projectCode: string): Promise<void> {
  // 查找已存在的项目
  const existingProject = await prisma.bidProject.findUnique({
    where: { projectCode },
    select: { id: true },
  });

  if (!existingProject) {
    console.log(`  ℹ 未找到已有项目 ${projectCode}，无需清理。`);
    return;
  }

  const projectId = existingProject.id;
  console.log(`  ⚠ 发现已存在项目 ${projectCode}，开始清理...`);

  // 查找关联的 BidDocument（通过 Announcement）
  const existingAnnouncement = await prisma.announcement.findFirst({
    where: { relatedProjectCode: projectCode },
    select: { id: true, bidDocument: { select: { id: true, fileAssetId: true } } },
  });

  const bidDocId = existingAnnouncement?.bidDocument?.id;
  const fileAssetId = existingAnnouncement?.bidDocument?.fileAssetId;

  // 1. BidDocumentAccess
  if (bidDocId) {
    await prisma.bidDocumentAccess.deleteMany({ where: { documentId: bidDocId } });
  }

  // 2. BidDocument + FileAsset + MinIO 对象
  if (bidDocId) {
    // 查找 FileAsset 以获取 MinIO key
    const fileAsset = fileAssetId
      ? await prisma.fileAsset.findUnique({ where: { id: fileAssetId } })
      : null;

    await prisma.bidDocument.delete({ where: { id: bidDocId } });

    if (fileAsset) {
      try {
        await minioClient.removeObject(MINIO_BUCKET, fileAsset.key);
        console.log(`    MinIO 对象已删除: ${fileAsset.key}`);
      } catch (e: any) {
        console.warn(`    MinIO 删除失败（可忽略）: ${e.message}`);
      }
      await prisma.fileAsset.delete({ where: { id: fileAsset.id } });
    }
  }

  // 3. BidSupplier
  await prisma.bidSupplier.deleteMany({ where: { projectId } });

  // 4. Announcement
  if (existingAnnouncement) {
    await prisma.announcement.delete({ where: { id: existingAnnouncement.id } });
  }

  // 5. BidProject
  await prisma.bidProject.delete({ where: { id: projectId } });

  console.log(`  ✔ 清理完成。`);
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  创建可投标项目 — 种子脚本');
  console.log('═══════════════════════════════════════════════════════\n');

  // 连接数据库
  await prisma.$connect();
  console.log('✔ 数据库已连接');

  // 确保 MinIO bucket 存在
  await ensureBucket();
  console.log('✔ MinIO bucket 就绪\n');

  // ── Step 0: 清理 ──
  console.log('── Step 0: 清理已有数据 ──');
  await cleanup(PROJECT_CODE);
  console.log('');

  // ── Step 1: 创建 BidProject ──
  console.log('── Step 1: 创建招标项目 ──');
  const bidProject = await prisma.bidProject.create({
    data: {
      projectCode: PROJECT_CODE,
      name: PROJECT_NAME,
      procurementMethod: '公开招标',
      // UTC 时间：北京时间 2026-07-16 10:00 = UTC 2026-07-16 02:00
      openTime: new Date('2026-07-16T02:00:00.000Z'),
      // UTC 时间：北京时间 2026-07-15 17:00 = UTC 2026-07-15 09:00
      deadline: new Date('2026-07-15T09:00:00.000Z'),
      stage: 'DOWNLOAD',
      riskNote: '（来自公告自动创建）',
      budget: 6800000,
      scope:
        '水利信息化平台升级改造，含数据中台扩容200TB、12套业务系统迁移、智能调度模块开发、统一身份认证平台建设及iOS/Android/小程序移动端适配',
      qualification:
        '1.独立法人资格\n2.电子与智能化工程专业承包二级及以上\n3.近三年类似水利信息化项目业绩不少于2个（合同额≥500万元）\n4.项目经理须具备信息系统项目管理师（高级）证书',
      contact: '联系人：信息技术部张工\n电话：028-88888001\n邮箱：zhanggong@scsdjt.com',
    },
  });
  console.log(`  ✔ BidProject 已创建`);
  console.log(`    id:          ${bidProject.id}`);
  console.log(`    projectCode: ${bidProject.projectCode}`);
  console.log(`    name:        ${bidProject.name}`);
  console.log(`    stage:       ${bidProject.stage}`);
  console.log(`    deadline:    ${bidProject.deadline.toISOString()}`);
  console.log(`    openTime:    ${bidProject.openTime.toISOString()}`);
  console.log('');

  // ── Step 2: 创建 Announcement（招标公告） ──
  console.log('── Step 2: 创建招标公告 ──');
  const announcementContent = `
<h2>${PROJECT_NAME}招标公告</h2>
<p>根据《中华人民共和国招标投标法》《中华人民共和国政府采购法》及四川水发集团采购管理制度，现就<strong>${PROJECT_NAME}</strong>组织公开招标活动，欢迎具备相应资质、业绩和履约能力的供应商参加。本公告内容为供应商报名、编制响应文件和参与评审的重要依据，请潜在投标人认真阅读并按系统要求提交资料。</p>

<h3>一、项目概况</h3>
<p>项目编号：${PROJECT_CODE}</p>
<p>采购方式：公开招标</p>
<p>预算金额：680万元</p>
<p>实施地点：成都市高新区天府大道北段1700号（集团数据中心）及下属5个分中心（绵阳、南充、宜宾、达州、凉山）</p>
<p>采购范围：数据中台扩容200TB、业务系统迁移12套、智能调度模块开发1套、统一身份认证平台1套、移动端适配（iOS/Android/小程序），以及为完成本项目所需的运输、安装调试、技术培训、售后保障、资料移交和验收配合等全部工作。</p>
<p>交付或服务周期：180日历天，具体起算时间以合同约定和采购人书面通知为准。</p>

<h3>二、供应商资格要求</h3>
<p>供应商须在中华人民共和国境内依法注册，具有独立承担民事责任的能力；具备电子与智能化工程专业承包二级及以上资质；近三年（2023-2026）至少完成2个合同金额不低于500万元的水利或水务信息化类似项目业绩；拟派项目经理须具备信息系统项目管理师（高级）证书且在投标单位连续缴纳社保不少于12个月；具有良好的商业信誉和健全的财务会计制度，近三年内未被列入失信被执行人、重大税收违法失信主体或政府采购严重违法失信行为记录名单；本项目不接受联合体投标。</p>

<h3>三、报名及文件获取</h3>
<p>潜在供应商应通过四川水发集团ERP供应商门户完成注册、资质维护和项目报名。报名资料应真实、完整、清晰，凡因资料缺失、证书过期、联系人信息错误或未按时确认澄清文件造成的后果，由供应商自行承担。采购文件、答疑澄清、补遗通知和开标安排均以平台发布内容为准。招标文件免费提供，不收取任何费用。</p>

<h3>四、投标要求</h3>
<p>投标文件应按照采购文件格式编制，报价应包含税费、运输、装卸、保险、安装、调试、培训、验收、质保和风险等完成合同的全部费用。供应商不得相互串通投标，不得以低于成本的报价竞争，不得提供虚假材料。投标截止时间：<strong>2026年7月15日17:00</strong>（北京时间）。开标时间：<strong>2026年7月16日10:00</strong>（北京时间）。开标方式：在线开标（蜀水云采平台开标大厅）。</p>

<h3>五、联系方式</h3>
<p>联系人：信息技术部张工</p>
<p>联系电话：028-88888001</p>
<p>电子邮箱：zhanggong@scsdjt.com</p>`;

  const announcement = await prisma.announcement.create({
    data: {
      title: `${PROJECT_NAME}招标公告`,
      content: announcementContent,
      aiSummary:
        '本项目为2026年度水利信息化平台升级改造，预算金额680万元，采用公开招标方式，实施地点覆盖集团数据中心及5个分中心。采购内容包括数据中台扩容200TB、12套业务系统迁移、智能调度模块开发及移动端适配等，工期180日历天。投标人须具备电子与智能化工程专业承包二级及以上资质及类似项目业绩，投标截止时间为2026年7月15日17:00，开标时间为2026年7月16日10:00。招标文件免费获取，不接受联合体投标。',
      type: 'BID_NOTICE',
      status: 'PUBLISHED',
      summary: `招标公告：${PROJECT_NAME}`,
      publishDate: new Date('2026-06-17T00:00:00.000Z'),
      isTop: true,
      relatedProjectCode: PROJECT_CODE,
      authorId: UPLOADER_ID,
      metadata: {
        method: '公开招标',
        budget: 6800000,
        scope:
          '数据中台扩容200TB、业务系统迁移12套、智能调度模块开发、统一身份认证平台、移动端适配',
        qualification:
          '电子与智能化工程专业承包二级及以上，近三年类似水利信息化项目业绩不少于2个',
        contact: '信息技术部张工 028-88888001',
        openTime: '2026-07-16T10:00:00.000+08:00',
        deadline: '2026-07-15T17:00:00.000+08:00',
      },
    },
  });
  console.log(`  ✔ Announcement 已创建`);
  console.log(`    id:     ${announcement.id}`);
  console.log(`    type:   ${announcement.type}`);
  console.log(`    status: ${announcement.status}`);
  console.log(`    isTop:  ${announcement.isTop}`);
  console.log('');

  // ── Step 3: 生成标书文件并加密上传到 MinIO ──
  console.log('── Step 3: 生成招标文件并加密上传 ──');
  const plaintextBuffer = generateBidDocumentBuffer();
  const sha256 = crypto.createHash('sha256').update(plaintextBuffer).digest('hex');
  const { ciphertext, decryptKey } = encryptBuffer(plaintextBuffer);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileKey = `bid-doc/${today}/${randomHex()}.enc`;

  await minioClient.putObject(MINIO_BUCKET, fileKey, ciphertext, ciphertext.length, {
    'Content-Type': 'application/octet-stream',
  });
  console.log(`  ✔ 密文已上传至 MinIO`);
  console.log(`    key:    ${fileKey}`);
  console.log(`    size:   ${ciphertext.length} bytes (密文)`);
  console.log(`    sha256: ${sha256} (原文)`);
  console.log('');

  // ── Step 4: 创建 FileAsset + BidDocument ──
  console.log('── Step 4: 创建 FileAsset + BidDocument ──');
  const fileAsset = await prisma.fileAsset.create({
    data: {
      key: fileKey,
      originalName: `${PROJECT_NAME}-招标文件.txt`,
      mimeType: 'text/plain; charset=utf-8',
      size: plaintextBuffer.length,
      sha256,
      category: 'bid_document',
      uploaderId: UPLOADER_ID,
      encrypted: false, // 应用层加密，MinIO 存的是密文
    },
  });

  const bidDocument = await prisma.bidDocument.create({
    data: {
      announcementId: announcement.id,
      fileAssetId: fileAsset.id,
      title: '招标文件',
      accessScope: 'OPEN',
      requirePayment: false,
      price: null,
      decryptKey,
      bidProjectId: bidProject.id,
      downloadCount: 0,
    },
  });
  console.log(`  ✔ FileAsset 已创建:  ${fileAsset.id}`);
  console.log(`  ✔ BidDocument 已创建: ${bidDocument.id}`);
  console.log(`    accessScope: OPEN (所有已批准供应商可下载)`);
  console.log('');

  // ── Step 5: 关联供应商 ──
  console.log('── Step 5: 创建 BidSupplier 关联 ──');
  const bidSuppliers: { id: string; name: string }[] = [];
  for (const s of SUPPLIERS) {
    const bs = await prisma.bidSupplier.create({
      data: {
        projectId: bidProject.id,
        supplierId: s.id,
        supplierName: s.name,
        downloadStatus: '待下载',
        submitStatus: '待提交',
        encryptStatus: '待校验',
        decryptStatus: 'PENDING',
        confirmStatus: 'PENDING',
      },
    });
    bidSuppliers.push({ id: bs.id, name: s.name });
    console.log(`  ✔ BidSupplier: ${s.name}`);
  }
  console.log('');

  // ── Step 6: 创建 BidDocumentAccess（供应商下载权限） ──
  console.log('── Step 6: 创建 BidDocumentAccess ──');
  for (const s of SUPPLIERS) {
    await prisma.bidDocumentAccess.create({
      data: {
        documentId: bidDocument.id,
        supplierId: s.id,
        eligible: true,
        paid: false,
        downloadCount: 0,
      },
    });
    console.log(`  ✔ BidDocumentAccess: ${s.name} (eligible=true)`);
  }
  console.log('');

  // ── 完成 ──
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ✔ 项目创建完成！');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  📋 供应商门户验证:');
  console.log(`     http://localhost:3004/bids`);
  console.log('');
  console.log('  📋 管理端查看:');
  console.log(`     http://localhost:3005/notice`);
  console.log('');
  console.log('  📋 项目详情 API:');
  console.log(`     GET http://localhost:4001/api/supplier-portal/bid-projects`);
  console.log('');

  console.log('  数据清单:');
  console.log(`    BidProject:          ${bidProject.id}`);
  console.log(`    Announcement:        ${announcement.id}`);
  console.log(`    FileAsset:           ${fileAsset.id}`);
  console.log(`    BidDocument:         ${bidDocument.id}`);
  console.log(`    BidSupplier:         ${bidSuppliers.length} 条`);
  console.log(`    BidDocumentAccess:   ${SUPPLIERS.length} 条`);
  console.log('');
}

// ─── 入口 ────────────────────────────────────────────────────

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ 脚本执行失败:');
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
