#!/usr/bin/env node
/**
 * 项目快照/恢复脚本 —— 演示专用。
 *
 *   node ../../scripts/demo-snapshot.js snapshot [项目编号] [快照名]
 *     → 把项目全量状态导出到 scripts/snapshots/<项目编号>-<快照名>.json
 *       （BidProject/PMI+阶段/公告+招标文件/供应商+标书/专家+评分/评分标准/AI 结果/开标会话与记录/澄清）
 *   node ../../scripts/demo-snapshot.js restore [快照文件路径]
 *     → 删除项目当前行并整体回滚到快照时刻（MinIO 文件资产不变，仅引用原 id）
 *
 * 默认项目编号：BID-1786934256839；默认快照名：demo。
 * 监督日志不随快照回滚（审计留痕），恢复时追加一条「快照恢复」记录。
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', 'apps', 'api', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const { createRequire } = require('module');
const apiRequire = createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const prisma = new PrismaClient();

const SNAP_DIR = path.join(__dirname, 'snapshots');
const MODE = process.argv[2];
const PROJECT_CODE = process.argv[3] || 'BID-1786934256839';
const SNAP_NAME = process.argv[4] || 'demo';

// 快照表清单：[表名, 主键列, 查询条件列]（条件列用 projectId 或经 BidProject/PMI 关联）
const TABLES = [
  ['BidProject', 'id', 'projectCode'],
  ['ProjectManagementItem', 'id', 'id'],          // 经 BidProject.projectManagementItemId
  ['ProjectManagementStage', 'id', 'projectManagementItemId'],
  ['Announcement', 'id', 'relatedProjectCode'],
  ['BidDocument', 'id', 'announcementId'],        // 经公告
  ['AnnouncementAttachment', 'id', 'announcementId'],
  ['BidSupplier', 'id', 'projectId'],
  ['SupplierBidSubmission', 'id', 'projectId'],
  ['BidExpert', 'id', 'projectId'],
  ['BidScoreRecord', 'id', 'expertId'],           // 经 BidExpert
  ['BidScoreItem', 'id', 'projectId'],
  ['BidScorePoint', 'id', 'scoreItemId'],
  ['BidOpeningSession', 'id', 'projectId'],
  ['BidOpeningRecord', 'id', 'projectId'],
  ['BidClarification', 'id', 'projectId'],
  ['BidEvaluationResult', 'id', 'projectId'],
  ['ai_bid_analysis_tasks', 'id', 'projectId'],
  ['ai_bidder_results', 'id', 'bidProjectId'],
];

async function collectProjectRefs(project) {
  const pmi = project.projectManagementItemId
    ? await prisma.projectManagementItem.findUnique({ where: { id: project.projectManagementItemId } })
    : null;
  const anns = await prisma.announcement.findMany({ where: { relatedProjectCode: project.projectCode } });
  const annIds = anns.map(a => a.id);
  const bidDocs = annIds.length ? await prisma.bidDocument.findMany({ where: { announcementId: { in: annIds } } }) : [];
  const experts = await prisma.bidExpert.findMany({ where: { projectId: project.id } });
  const expertIds = experts.map(e => e.id);
  const items = await prisma.bidScoreItem.findMany({ where: { projectId: project.id } });
  const itemIds = items.map(i => i.id);
  return { pmi, annIds, expertIds, itemIds };
}

async function snapshot() {
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) { console.error(`项目 ${PROJECT_CODE} 不存在`); return; }
  const refs = await collectProjectRefs(project);

  const data = {};
  for (const [table, pk, keyCol] of TABLES) {
    let rows = [];
    if (table === 'BidProject') rows = [project];
    else if (table === 'ProjectManagementItem') rows = refs.pmi ? [refs.pmi] : [];
    else if (table === 'ProjectManagementStage') rows = refs.pmi
      ? await prisma.$queryRawUnsafe(`SELECT * FROM "ProjectManagementStage" WHERE "projectManagementItemId"=$1`, refs.pmi.id)
      : [];
    else if (table === 'Announcement') rows = await prisma.$queryRawUnsafe(`SELECT * FROM "Announcement" WHERE "relatedProjectCode"=$1`, PROJECT_CODE);
    else if (table === 'BidDocument') rows = refs.annIds.length
      ? await prisma.$queryRawUnsafe(`SELECT * FROM "BidDocument" WHERE "announcementId" = ANY($1::text[])`, refs.annIds)
      : [];
    else if (table === 'AnnouncementAttachment') rows = refs.annIds.length
      ? await prisma.$queryRawUnsafe(`SELECT * FROM "AnnouncementAttachment" WHERE "announcementId" = ANY($1::text[])`, refs.annIds)
      : [];
    else if (table === 'BidScoreRecord') rows = refs.expertIds.length
      ? await prisma.$queryRawUnsafe(`SELECT * FROM "BidScoreRecord" WHERE "expertId" = ANY($1::text[])`, refs.expertIds)
      : [];
    else if (table === 'BidScorePoint') rows = refs.itemIds.length
      ? await prisma.$queryRawUnsafe(`SELECT * FROM "BidScorePoint" WHERE "scoreItemId" = ANY($1::text[])`, refs.itemIds)
      : [];
    else if (table === 'BidOpeningSession' || table === 'BidOpeningRecord' || table === 'BidClarification'
      || table === 'BidEvaluationResult' || table === 'BidSupplier' || table === 'SupplierBidSubmission'
      || table === 'BidExpert' || table === 'BidScoreItem' || table === 'ai_bid_analysis_tasks') {
      rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}" WHERE "projectId"=$1`, project.id);
    } else if (table === 'ai_bidder_results') {
      const supplierIds = await prisma.bidSupplier.findMany({ where: { projectId: project.id }, select: { id: true } });
      rows = supplierIds.length
        ? await prisma.$queryRawUnsafe(`SELECT * FROM ai_bidder_results WHERE "bidSupplierId" = ANY($1::text[])`, supplierIds.map(s => s.id))
        : [];
    }
    // 原始行含 Date/BigInt——归一化为 JSON 安全值
    data[table] = rows.map(r => JSON.parse(JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() : v)));
    console.log(`  ${table}: ${rows.length} 行`);
  }

  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const file = path.join(SNAP_DIR, `${PROJECT_CODE}-${SNAP_NAME}.json`);
  fs.writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), projectCode: PROJECT_CODE, data }, null, 2));
  console.log(`✅ 快照已保存：${file}`);
}

async function restore() {
  const file = process.argv[3];
  if (!file || !fs.existsSync(file)) { console.error('请提供快照文件路径（restore <文件>）'); return; }
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const projectCode = snap.projectCode;
  const data = snap.data;
  const project = await prisma.bidProject.findUnique({ where: { projectCode } });

  // ① 清空现有行（子→父顺序）
  const clear = [
    'OpeningHallReadCursor', 'OpeningHallMessage', 'BidOpeningRecord', 'BidOpeningSession',
    'SupplierBidSubmission', 'BidSupplier', 'BidScoreRecord', 'BidExpert', 'BidScorePoint', 'BidScoreItem',
    'BidClarification', 'BidEvaluationResult', 'BidSignPacket', 'BidArchiveItem',
    'ai_bidder_results', 'ai_bid_analysis_tasks',
  ];
  if (project) {
    for (const t of clear) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "projectId"=$1`, project.id).catch(() => {});
    }
    const supIds = await prisma.bidSupplier.findMany({ where: { projectId: project.id }, select: { id: true } });
    if (supIds.length) await prisma.$executeRawUnsafe(`DELETE FROM ai_bidder_results WHERE "bidSupplierId" = ANY($1::text[])`, supIds.map(s => s.id)).catch(() => {});
    const anns = await prisma.announcement.findMany({ where: { relatedProjectCode: projectCode }, select: { id: true } });
    for (const a of anns) {
      await prisma.$executeRawUnsafe(`DELETE FROM "BidDocument" WHERE "announcementId"=$1`, a.id).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "AnnouncementAttachment" WHERE "announcementId"=$1`, a.id).catch(() => {});
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "Announcement" WHERE "relatedProjectCode"=$1`, projectCode);
    if (project.projectManagementItemId) {
      await prisma.$executeRawUnsafe(`DELETE FROM "ProjectManagementStage" WHERE "projectManagementItemId"=$1`, project.projectManagementItemId);
      await prisma.$executeRawUnsafe(`DELETE FROM "ProjectManagementItem" WHERE "id"=$1`, project.projectManagementItemId);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "BidProject" WHERE "id"=$1`, project.id);
  }

  // ② 按快照回灌（父→子；显式 id；走 Prisma 模型以正确处理 Decimal/DateTime/枚举）
  const MODELS = {
    ProjectManagementItem: prisma.projectManagementItem,
    ProjectManagementStage: prisma.projectManagementStage,
    BidProject: prisma.bidProject,
    Announcement: prisma.announcement,
    BidDocument: prisma.bidDocument,
    AnnouncementAttachment: prisma.announcementAttachment,
    BidSupplier: prisma.bidSupplier,
    SupplierBidSubmission: prisma.supplierBidSubmission,
    BidExpert: prisma.bidExpert,
    BidScoreItem: prisma.bidScoreItem,
    BidScorePoint: prisma.bidScorePoint,
    BidScoreRecord: prisma.bidScoreRecord,
    BidOpeningSession: prisma.bidOpeningSession,
    BidOpeningRecord: prisma.bidOpeningRecord,
    BidClarification: prisma.bidClarification,
    BidEvaluationResult: prisma.bidEvaluationResult,
    ai_bid_analysis_tasks: prisma.aiBidAnalysisTask,
    ai_bidder_results: prisma.aiBidderResult,
  };
  // CI/异 KMS 环境适配（SNAPSHOT_RESEAL_CRYPTO=1 时生效，dev 默认关闭保持原值）：
  // 快照内 SupplierBidSubmission 的 sealedKey/bidPrice 是 dev KMS_SECRET 包裹的——
  // 换 KMS 环境解不开（解密全 DANGER）。此模式：①缺失的 FileAsset 补桩（dummy
  // 密文对象 + 哈希）②sealedKey 置 null（走 legacy 完整性校验路径）③bidPrice
  // 用本环境 KMS 重封确定性占位价（唱标/记录链可续）。产物仅作冒烟，非证据。
  if (process.env.SNAPSHOT_RESEAL_CRYPTO === '1' && Array.isArray(data['SupplierBidSubmission'])) {
    console.log('▶ CI 重封模式（SNAPSHOT_RESEAL_CRYPTO=1）');
    const kms = process.env.KMS_SECRET;
    if (!kms) throw new Error('CI 重封模式需要 KMS_SECRET');
    const crypto = require('crypto');
    const seal = (plain) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update('water-erp-field-seal-v1').update(kms).digest(), iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    };
    // ① FileAsset 桩
    const stubIds = new Set();
    for (const row of data['SupplierBidSubmission']) {
      for (const col of ['technicalFileAssetId', 'businessFileAssetId', 'coverLetterAssetId']) {
        if (row[col]) stubIds.add(row[col]);
      }
    }
    // minio.client.ts 是 TS 源码不能被裸 node require——按同口径从 env 构造 Client
    const Minio = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'minio'));
    const minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'water_erp_minio',
      secretKey: process.env.MINIO_SECRET_KEY || 'water_erp_minio_dev',
    });
    const MINIO_BUCKET = process.env.MINIO_BUCKET || 'water-erp';
    let stubbed = 0;
    for (const id of stubIds) {
      if (await prisma.fileAsset.findUnique({ where: { id } })) continue;
      const buf = Buffer.from(`snapshot-stub-${id}`);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const key = `snapshot-stub/${id}`;
      await minioClient.putObject(MINIO_BUCKET, key, buf, buf.length, { 'Content-Type': 'application/octet-stream' });
      await prisma.fileAsset.create({ data: { id, key, originalName: `stub-${id}.bin`, mimeType: 'application/octet-stream', size: buf.length, sha256: sha, category: 'bid_document', encrypted: false, clientEncrypted: false } });
      stubbed++;
    }
    console.log(`    FileAsset 补桩 ${stubbed}/${stubIds.size}`);
    // ②③ sealedKey 置空 + bidPrice 重封
    let idx = 0;
    for (const row of data['SupplierBidSubmission']) {
      row.technicalSealedKey = null;
      row.businessSealedKey = null;
      row.coverLetterSealedKey = null;
      row.bidPrice = seal(String(1000000 * (++idx)));
    }
    console.log(`    ${data['SupplierBidSubmission'].length} 行 sealedKey 清空 + bidPrice 重封`);
  }

  // 回灌期临时禁用 FK 校验（CI 全新库快照引用的 FileAsset 等父行可能不存在——
  // dev 上这些行由 seed PDF 生成、ID 每次新造）。CI postgres 为超管可用；
  // dev 应用账号非超管时静默跳过，保持原有严格 FK 行为。
  let fkBypassed = false;
  try {
    await prisma.$executeRawUnsafe('SET session_replication_role = replica');
    fkBypassed = true;
  } catch { /* 非超管（dev）——保持原行为 */ }
  try {
    for (const table of Object.keys(MODELS)) {
      const model = MODELS[table];
      for (const row of data[table] || []) {
        await model.create({ data: row }).catch((e) => {
          console.error(`  回灌 ${table} 行失败（id=${row.id}）：${e.message?.slice(0, 140)}`);
          throw e;
        });
      }
    }
  } finally {
    if (fkBypassed) {
      try { await prisma.$executeRawUnsafe('SET session_replication_role = DEFAULT'); } catch { /* ignore */ }
    }
  }

  // ③ 留痕
  await prisma.bidSupervisionLog.create({
    data: {
      projectId: data.BidProject[0].id, time: new Date(), role: '系统', target: '快照恢复',
      action: '演示状态回滚', result: `恢复到快照 ${path.basename(file)}（${snap.capturedAt}）`, riskFlag: '—',
    },
  });
  console.log(`✅ 已从快照恢复：${path.basename(file)}（捕获于 ${snap.capturedAt}）`);
}

(async () => {
  try {
    if (MODE === 'snapshot') await snapshot();
    else if (MODE === 'restore') await restore();
    else console.log('用法：node demo-snapshot.js snapshot|restore [项目编号] [快照名/文件]');
  } catch (e) {
    console.error('脚本执行失败：', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
