// apps/api/scripts/backfill-opening-handover.ts
/**
 * 存量开标文件包回填（2026-09-22 审查 P1-2 + P2-2 存量面）。
 *
 * 背景：开标文件包（bid-opening-handover/{bpId}.json）初建于 09-14 单位铁律之前的存量包，
 * dual-v2 唱标金额是裸数字（无 amountUnit、无「N 万元」渲染）；且会场交流（hallMessages，
 * 09-22 入包裁定）只对新开标项目生效。completeOpening 幂等短路 + 开标签字重建走旧 JSON
 * 追加段——两条路径都不重跑 buildHandoverPackage，存量包不会自愈，须本脚本对齐：
 *   ① 单位：amountUnit 戳缺 + 双信封 dual-v2 回退推导为「万元」+ 裸数字 → 补「N 万元」
 *      （口径与 src/bid/opening-amount-unit.util.ts 的 resolveOpeningAmountUnitMap/formatAmountWithUnit/
 *      BARE_NUM_RE 一致；此处内联实现保持脚本零 Nest 依赖——clean-legacy-plaintext 先例）
 *   ② 会场交流：包无 hallMessages 段且 DB 有消息 → 注入 + packageVersion→2
 *   ③ 透明标记 legacyBackfill{at,fields}；fingerprint 重算（sha256(JSON.stringify(body))）；
 *      FileAsset 行同步刷新 size/sha256（buffer 哈希，与 completeOpening 同口径）
 *
 * 用法：
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts            # dry-run（默认，零副作用）
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts --execute  # 真实执行
 *
 * 幂等：单位已带/已渲染跳过；hallMessages 已存在不重复注入；--execute 重跑为 no-op。
 */
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import * as crypto from 'node:crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── .env 加载（先于 PrismaClient / MinIO Client 实例化；dotenv 语义：不覆盖已有）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
    return p;
  }
  return null;
}
const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
loadEnvFile([join(scriptDir, '..', '.env'), join(process.cwd(), '.env')]);

const DUAL_V2_AMOUNT_UNIT = '万元'; // 与 packages/shared DUAL_V2_AMOUNT_UNIT 对齐
// 与 src/bid/opening-amount-unit.util.ts 的 BARE_NUM_RE 逐字一致——勿自造变体
const BARE_NUM_RE = /^[\d,]+(?:\.\d+)?$/;

// ── 纯函数：包回填计划与应用（spec 消费）──
export interface LegacyRecord {
  supplierName?: string;
  bidSupplierId?: string | null;
  amount?: unknown;
  amountUnit?: string | null;
  [k: string]: unknown;
}
export interface LegacyPkg {
  packageType?: string;
  packageVersion?: number;
  openingRecords?: LegacyRecord[];
  hallMessages?: unknown;
  legacyBackfill?: unknown;
  fingerprint?: string;
  [k: string]: unknown;
}
export interface HallMsgRow {
  roomType: string;
  supplierId: string | null;
  senderName: string;
  senderRole: string;
  type: string;
  content: string;
  fileAssetId: string | null;
  createdAt: Date;
}
export interface BackfillPlan {
  changed: boolean;
  fields: string[];
  recordChanges: Array<{ supplierName: string; from: string; to: string }>;
  addedMessages: number;
}

export function applyOpeningPackageBackfill(
  pkg: LegacyPkg,
  unitByBsId: Map<string, string | null>,
  hallMessages: HallMsgRow[],
  supplierNameBySupplierId: Map<string, string>,
  now: Date,
): { pkg: LegacyPkg; plan: BackfillPlan } {
  const plan: BackfillPlan = { changed: false, fields: [], recordChanges: [], addedMessages: 0 };
  const out: LegacyPkg = { ...pkg };
  const records = Array.isArray(pkg.openingRecords) ? pkg.openingRecords.map(r => ({ ...r })) : undefined;
  if (records) {
    for (const r of records) {
      const unit = r.amountUnit ?? (r.bidSupplierId ? unitByBsId.get(r.bidSupplierId) ?? null : null);
      const amountStr = typeof r.amount === 'string' ? r.amount.trim() : r.amount == null ? '' : String(r.amount);
      if (!r.amountUnit && unit === DUAL_V2_AMOUNT_UNIT && BARE_NUM_RE.test(amountStr)) {
        plan.recordChanges.push({ supplierName: r.supplierName ?? '(未知)', from: amountStr, to: `${amountStr} ${DUAL_V2_AMOUNT_UNIT}` });
        r.amount = `${amountStr} ${DUAL_V2_AMOUNT_UNIT}`;
        r.amountUnit = DUAL_V2_AMOUNT_UNIT;
      }
    }
    if (plan.recordChanges.length > 0) {
      out.openingRecords = records;
      plan.fields.push('amountUnit');
      plan.changed = true;
    }
  }
  if (!('hallMessages' in pkg) && hallMessages.length > 0) {
    out.hallMessages = hallMessages.map(m => ({
      room: m.roomType,
      supplierName: m.supplierId ? supplierNameBySupplierId.get(m.supplierId) ?? null : null,
      senderName: m.senderName, senderRole: m.senderRole, type: m.type, content: m.content,
      fileAssetId: m.fileAssetId, createdAt: m.createdAt.toISOString(),
    }));
    out.packageVersion = 2; // 与 buildHandoverPackage 现行版本对齐（+hallMessages）
    plan.fields.push('hallMessages');
    plan.addedMessages = hallMessages.length;
    plan.changed = true;
  }
  if (!plan.changed) return { pkg, plan }; // 幂等：零变更原样返回，不碰指纹
  out.legacyBackfill = { at: now.toISOString(), fields: plan.fields };
  // fingerprint 重算：与 buildHandoverPackage 同口径——sha256(JSON.stringify(body 无 fingerprint 键))
  const { fingerprint: _old, ...body } = out;
  void _old;
  out.fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { pkg: out, plan };
}

// ── 单位解析（内联复刻 resolveOpeningAmountUnitMap：戳优先 → dual-v2 回退）──
async function resolveUnits(prisma: PrismaClient, projectId: string): Promise<Map<string, string | null>> {
  const [bidSuppliers, subs, stampedRows] = await Promise.all([
    prisma.bidSupplier.findMany({ where: { projectId }, select: { id: true, supplierId: true } }),
    prisma.supplierBidSubmission.findMany({ where: { projectId }, select: { supplierId: true, envelopeVersion: true } }),
    prisma.bidOpeningRecord.findMany({ where: { projectId }, select: { bidSupplierId: true, amountUnit: true } }),
  ]);
  const dualSet = new Set(subs.filter(s => s.envelopeVersion === 'dual-v2').map(s => s.supplierId));
  const stampedByBs = new Map(
    stampedRows.filter(r => r.amountUnit && r.bidSupplierId).map(r => [r.bidSupplierId as string, r.amountUnit as string]),
  );
  return new Map(bidSuppliers.map(b => [
    b.id,
    stampedByBs.get(b.id) ?? (b.supplierId && dualSet.has(b.supplierId) ? DUAL_V2_AMOUNT_UNIT : null),
  ]));
}

// ── main ──
async function main() {
  const execute = process.argv.includes('--execute');
  const prisma = new PrismaClient();
  // 与 src/upload/minio.client.ts 相同的环境回退（不 import Nest 模块，避免装饰器依赖）
  const minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'water_erp_minio',
    secretKey: process.env.MINIO_SECRET_KEY || 'water_erp_minio_dev',
  });
  const bucket = process.env.MINIO_BUCKET || 'water-erp';

  const assets = await prisma.fileAsset.findMany({
    where: { key: { startsWith: 'bid-opening-handover/' } },
    select: { id: true, key: true },
    orderBy: { key: 'asc' },
  });
  console.log(`发现开标文件包 ${assets.length} 个（模式：${execute ? 'EXECUTE' : 'DRY-RUN'}）`);
  let touched = 0;
  for (const fa of assets) {
    const bpId = fa.key.slice('bid-opening-handover/'.length).replace(/\.json$/, '');
    try {
      const pkgRaw = await minioClient.getObject(bucket, fa.key);
      const chunks: Buffer[] = [];
      for await (const c of pkgRaw) chunks.push(c as Buffer);
      const pkg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as LegacyPkg;
      const [unitMap, hallMessages, bidSuppliers] = await Promise.all([
        resolveUnits(prisma, bpId),
        prisma.openingHallMessage.findMany({
          where: { projectId: bpId },
          orderBy: { createdAt: 'asc' },
          select: { roomType: true, supplierId: true, senderName: true, senderRole: true, type: true, content: true, fileAssetId: true, createdAt: true },
        }),
        prisma.bidSupplier.findMany({ where: { projectId: bpId }, select: { supplierId: true, supplierName: true } }),
      ]);
      const supplierNameBySupplierId = new Map(
        bidSuppliers.filter(s => s.supplierId != null).map(s => [s.supplierId as string, s.supplierName]),
      );
      const { pkg: next, plan } = applyOpeningPackageBackfill(pkg, unitMap, hallMessages, supplierNameBySupplierId, new Date());
      if (!plan.changed) {
        console.log(`✓ ${bpId} 无需回填`);
        continue;
      }
      console.log(`△ ${bpId}：${plan.fields.join('+')}（金额 ${plan.recordChanges.length} 条${plan.addedMessages ? `，会场消息 ${plan.addedMessages} 条` : ''}）`);
      for (const rc of plan.recordChanges) console.log(`    ${rc.supplierName}: ${rc.from} → ${rc.to}`);
      if (!execute) continue;
      const buffer = Buffer.from(JSON.stringify(next, null, 2), 'utf8');
      await minioClient.putObject(bucket, fa.key, buffer, buffer.length, { 'Content-Type': 'application/json' });
      // buffer 哈希（≠body 指纹）——与 completeOpening 的 FileAsset 登记口径一致
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      await prisma.fileAsset.update({ where: { id: fa.id }, data: { size: buffer.length, sha256 } });
      touched += 1;
      console.log(`    已上传 + FileAsset 指纹刷新（sha256 ${sha256.slice(0, 16)}…）`);
    } catch (err) {
      console.error(`✗ ${bpId}（${fa.key}）处理失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(execute ? `完成：更新 ${touched} 个包` : 'DRY-RUN 结束（--execute 生效）');
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
