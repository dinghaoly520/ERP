#!/usr/bin/env node
/**
 * U盾全流程演示项目脚本 —— 搭建「供应商 U盾加密投递 → 开标 U盾解密」所需的最小项目
 *
 * 与 demo-decrypt-project.js 分工不同：本项目走 dual-v2 新轨，从 DOWNLOAD 起步，
 * 让「四川水发建设有限公司」真实经浏览器 U盾（厂商中间件 :17999）投递，再转 OPENING
 * 供开标大厅供应商侧 U盾解密演示。
 *
 * 用法（在 water-erp/apps/api 目录下）：
 *   node ../../scripts/demo-ukey-flow.js create      # 建 DOWNLOAD 项目+受邀供应商（幂等：先清旧）
 *   node ../../scripts/demo-ukey-flow.js to-opening  # 投递完成后：转 OPENING、时间口径刷新为 now
 *   node ../../scripts/demo-ukey-flow.js reset       # 清开标过程数据，回 OPENING 待组建会话（重演场景 B）
 *   node ../../scripts/demo-ukey-flow.js status      # 打印项目/供应商/提交状态
 *
 * 时间口径（对齐 demo-decrypt-project.js 与 BID_DEADLINE_BEFORE_OPENING_MS）：
 *   create:      deadline=now+1d, openTime=now+2d, downloadDeadline=now+1d
 *   to-opening:  openTime=now, deadline=now-24h, downloadDeadline=now+30min
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
const { createId } = apiRequire('@paralleldrive/cuid2');
const { PrismaClient } = apiRequire('@prisma/client');
const prisma = new PrismaClient();

const MODE = process.argv[2] || 'status';
const DEMO_CODE_PREFIX = 'BID-UKEY-';
const DEMO_NAME = 'U盾全流程演示项目 — 供应商双信封加密投递与开标解密';
const SUPPLIER_NAME = '四川水发建设有限公司';

const now = () => new Date();

async function findDemo() {
  return prisma.bidProject.findFirst({ where: { projectCode: { startsWith: DEMO_CODE_PREFIX } } });
}

async function wipeProject(projectId) {
  await prisma.$executeRawUnsafe('DELETE FROM "OpeningHallReadCursor" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "OpeningHallMessage" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidOpeningSession" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidOpeningRecord" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "SupplierBidSubmission" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidSupplier" WHERE "projectId"=$1', projectId);
  await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
  await prisma.bidProject.delete({ where: { id: projectId } });
}

async function create() {
  const supplier = await prisma.supplier.findFirst({ where: { name: SUPPLIER_NAME } });
  if (!supplier) { console.error(`供应商「${SUPPLIER_NAME}」不存在（先跑 pnpm db:seed）`); return; }
  const existing = await findDemo();
  if (existing) { console.log(`发现旧演示项目 ${existing.projectCode}，整体重建…`); await wipeProject(existing.id); }

  const t = now();
  const projectId = createId();
  const ts = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
  const projectCode = `${DEMO_CODE_PREFIX}${ts}`;

  await prisma.bidProject.create({
    data: {
      id: projectId,
      projectCode,
      name: DEMO_NAME,
      procurementMethod: '公开招标',
      openTime: new Date(t.getTime() + 48 * 3600_000),
      deadline: new Date(t.getTime() + 24 * 3600_000),
      downloadDeadline: new Date(t.getTime() + 24 * 3600_000),
      stage: 'DOWNLOAD',
      round: 1,
      currentRoundNo: 1,
      bondRequired: false,
      isExtractionOnly: false,
    },
  });
  await prisma.bidSupplier.create({
    data: {
      id: createId(),
      projectId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      downloadStatus: '已下载',
      submitStatus: '待提交',
      encryptStatus: '待校验',
      receiptNo: '',
      decryptStatus: 'PENDING',
      confirmStatus: 'PENDING',
    },
  });
  await prisma.bidSupervisionLog.create({
    data: {
      projectId, time: t, role: '系统', target: 'U盾演示',
      action: '演示项目创建', result: 'DOWNLOAD 阶段 + 受邀供应商（四川水发建设有限公司），待 U盾双信封投递', riskFlag: '—',
    },
  });
  console.log(`✅ 已创建演示项目 ${projectCode}（DOWNLOAD，截标=now+24h）`);
  console.log(`   供应商：${supplier.name}（已受邀）`);
  console.log(`   :3004 http://localhost:3004/bids  → 可投标项目 中找「${DEMO_NAME}」`);
}

async function toOpening() {
  const demo = await findDemo();
  if (!demo) { console.log('未找到演示项目（BID-UKEY-*），请先执行 create'); return; }
  const t = now();
  await prisma.$transaction(async (tx) => {
    await tx.bidProject.update({
      where: { id: demo.id },
      data: {
        stage: 'OPENING',
        openTime: t,
        deadline: new Date(t.getTime() - 24 * 3600_000),
        downloadDeadline: new Date(t.getTime() + 30 * 60_000),
      },
    });
    await tx.bidSupervisionLog.create({
      data: {
        projectId: demo.id, time: t, role: '系统', target: 'U盾演示',
        action: '演示转开标', result: 'OPENING（开标=now、截标=now-24h、解密窗口 now~+30min），待主持端组建会话', riskFlag: '—',
      },
    });
  });
  console.log(`✅ ${demo.projectCode} → OPENING（待组建开标会话）`);
  console.log(`   :3007 http://localhost:3007/bid/project/${demo.id}（陈源远 登录组建会话+解外层）`);
}

async function reset() {
  const demo = await findDemo();
  if (!demo) { console.log('未找到演示项目（BID-UKEY-*），请先执行 create'); return; }
  const t = now();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('DELETE FROM "OpeningHallReadCursor" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe('DELETE FROM "OpeningHallMessage" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe('DELETE FROM "BidOpeningSession" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe('DELETE FROM "BidOpeningRecord" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe(
      `UPDATE "BidSupplier" SET "decryptStatus"='PENDING', "confirmStatus"='PENDING', "checkInAt"=NULL, "lastSeenAt"=NULL, "dangerAttribution"=NULL WHERE "projectId"=$1`,
      demo.id,
    );
    await tx.bidProject.update({
      where: { id: demo.id },
      data: {
        stage: 'OPENING',
        openTime: t,
        deadline: new Date(t.getTime() - 24 * 3600_000),
        downloadDeadline: new Date(t.getTime() + 30 * 60_000),
      },
    });
  });
  console.log(`✅ ${demo.projectCode} 已重置 → OPENING（开标时间=now，会话/解密/唱标已清）`);
}

async function status() {
  const demo = await findDemo();
  if (!demo) { console.log('无演示项目（BID-UKEY-*）'); return; }
  console.log(`项目 ${demo.projectCode}  stage=${demo.stage}  deadline=${demo.deadline.toISOString()}  openTime=${demo.openTime.toISOString()}`);
  const bs = await prisma.bidSupplier.findMany({ where: { projectId: demo.id }, select: { supplierName: true, submitStatus: true, decryptStatus: true, confirmStatus: true, checkInAt: true } });
  for (const b of bs) console.log(`  ${b.supplierName}  submit=${b.submitStatus}  decrypt=${b.decryptStatus}  confirm=${b.confirmStatus}  checkIn=${b.checkInAt ?? '—'}`);
  const subs = await prisma.supplierBidSubmission.findMany({ where: { projectId: demo.id }, select: { supplierId: true, status: true, envelopeVersion: true, bidPrice: true } });
  for (const s of subs) console.log(`  submission: status=${s.status}  envelopeVersion=${s.envelopeVersion}  price=${s.bidPrice}`);
  const sess = await prisma.bidOpeningSession.findFirst({ where: { projectId: demo.id } });
  console.log(`  session: ${sess ? `${sess.status} (id=${sess.id})` : '无'}`);
}

main().finally(() => prisma.$disconnect());

async function main() {
  if (MODE === 'create') return create();
  if (MODE === 'to-opening') return toOpening();
  if (MODE === 'reset') return reset();
  return status();
}
