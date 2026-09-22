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
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts                          # dry-run（默认，零副作用）
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts --execute                # 真实执行回填
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts --rebuild-missing        # 对象缺失的包从 DB 重建（dry-run）
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts --rebuild-missing --execute
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts --prune-dangling         # 悬空证据行清理（dry-run）
 *   cd apps/api && npx tsx scripts/backfill-opening-handover.ts --prune-dangling --execute
 *   （--prune-dangling：快照恢复后 MinIO 对象被清、DB FileAsset 行残留的死引用修复；
 *     ExpertMemo.inkFileId 引用置空后删行——备忘文本仍在，仅笔迹图丢失）
 *
 * 幂等：单位已带/已渲染跳过；hallMessages 已存在不重复注入；--execute 重跑为 no-op。
 */
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import * as crypto from 'node:crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
// 纯 util（零 Nest 依赖）——A-100 接收序与 buildHandoverPackage 同口径
import { sortSupplierRowsBySubmission } from '../src/bid/supplier-row-order.util';

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

// ── 对象缺失时从 DB 重建整包（--rebuild-missing）──
// 形状复刻 bid.service.ts buildHandoverPackage（v2 口径：单位戳 + hallMessages）；
// 两处刻意差异：① 不含 signatures 段——开标签字重登记时 rebuildHandoverWithSignatures
// 会下载本包再追加（与正常链路一致）；② stage 取当前值（原包为移交时点），
// legacyBackfill.fields=['rebuild'] 显式标记这是重建件。
export interface RebuildInput {
  project: { id: string; projectCode: string; name: string; procurementMethod: string; openTime: Date | null; deadline: Date | null; stage: string; roundMode: string | null };
  session: { host: string; supervisor: string | null; decryptWindowStart: Date; decryptWindowEnd: Date; status: string };
  suppliers: Array<Record<string, unknown>>;
  submissions: Array<{ supplierId: string | null; envelopeVersion: string | null; decryptedAssets: unknown; status: string | null; submittedAt: Date | null }>;
  records: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  bidRounds: Array<Record<string, unknown>>;
  hallMessages: HallMsgRow[];
  decryptedShaByAssetId: Map<string, string>;
  unitByBsId: Map<string, string | null>;
  supplierNameBySupplierId: Map<string, string>;
  now: Date;
}

export function buildOpeningPackageFromRows(input: RebuildInput): LegacyPkg {
  const submissionBySupplierId = new Map(input.submissions.map(s => [s.supplierId, s]));
  const recordsWithUnit = input.records.map((r: any) => {
    const unit = r.amountUnit ?? ((r.bidSupplierId ? input.unitByBsId.get(r.bidSupplierId) : null) ?? null);
    const amountStr = r.amount == null ? '' : String(r.amount).trim();
    const rendered = !r.amountUnit && unit === DUAL_V2_AMOUNT_UNIT && BARE_NUM_RE.test(amountStr)
      ? `${amountStr} ${DUAL_V2_AMOUNT_UNIT}`
      : amountStr;
    return { ...r, amount: rendered, amountUnit: unit };
  });
  const suppliersWithSortKeys = input.suppliers.map((s: any) => {
    const submission = submissionBySupplierId.get(s.supplierId);
    const decryptedAssets = (submission && submission.envelopeVersion === 'dual-v2'
      && submission.decryptedAssets && typeof submission.decryptedAssets === 'object')
      ? submission.decryptedAssets as Record<string, unknown> : null;
    const byRole: Record<string, string | null> = {};
    if (decryptedAssets) {
      for (const [role, assetId] of Object.entries(decryptedAssets)) {
        byRole[role] = typeof assetId === 'string' ? input.decryptedShaByAssetId.get(assetId) ?? null : null;
      }
    }
    return {
      ...s,
      decryptedFileSha256: decryptedAssets ? byRole : null,
      submitted: submission?.status === 'submitted',
      withdrawn: submission?.status === 'withdrawn',
      submission: submission ? { submittedAt: submission.submittedAt } : null,
    };
  });
  const orderedSuppliers = sortSupplierRowsBySubmission(
    suppliersWithSortKeys as Array<{ submitted: boolean; withdrawn: boolean; submission: { submittedAt: Date | null } | null }>,
  ).map(({ submitted: _s, withdrawn: _w, submission: _m, ...rest }: Record<string, unknown>) => rest) as Array<Record<string, unknown>>;
  const active = (input.suppliers as Array<Record<string, unknown>>).filter((s) => s.submitStatus !== '已撤回') as Array<Record<string, unknown>>;
  const dec = (s: { decryptStatus?: string }) => s.decryptStatus === 'SUCCESS';
  const conf = (s: { confirmStatus?: string }) => s.confirmStatus === 'CONFIRMED';
  const body: Record<string, unknown> = {
    packageType: 'BID_OPENING_HANDOVER',
    packageVersion: 2, // 与 buildHandoverPackage 现行版本一致（含 hallMessages）
    generatedAt: input.now.toISOString(),
    project: {
      id: input.project.id, projectCode: input.project.projectCode, name: input.project.name,
      procurementMethod: input.project.procurementMethod,
      openTime: input.project.openTime?.toISOString() ?? null,
      deadline: input.project.deadline?.toISOString() ?? null,
      stage: input.project.stage,
    },
    session: {
      host: input.session.host, supervisor: input.session.supervisor,
      decryptWindowStart: input.session.decryptWindowStart.toISOString(),
      decryptWindowEnd: input.session.decryptWindowEnd.toISOString(),
    },
    suppliers: orderedSuppliers,
    openingRecords: recordsWithUnit,
    supervisionLogs: input.logs.map((l: any) => ({
      ...l, time: l.time?.toISOString?.() ?? l.time ?? null,
    })),
    ...(input.bidRounds.length > 0 ? { bidRounds: input.bidRounds } : {}),
    ...(input.hallMessages.length > 0 ? {
      hallMessages: input.hallMessages.map(m => ({
        room: m.roomType,
        supplierName: m.supplierId ? input.supplierNameBySupplierId.get(m.supplierId) ?? null : null,
        senderName: m.senderName, senderRole: m.senderRole, type: m.type, content: m.content,
        fileAssetId: m.fileAssetId, createdAt: m.createdAt.toISOString(),
      })),
    } : {}),
    summary: {
      supplierTotal: input.suppliers.length,
      active: active.length,
      decrypted: active.filter(dec).length,
      decryptFailed: active.filter(s => s.decryptStatus === 'DANGER').length,
      recorded: input.records.length,
      confirmed: active.filter(conf).length,
      disputed: active.filter(s => s.confirmStatus === 'DISPUTED').length,
      withdrawn: input.suppliers.length - active.length,
    },
    legacyBackfill: { at: input.now.toISOString(), fields: ['rebuild'] },
  };
  body.fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return body as LegacyPkg;
}

// ── main ──
async function main() {
  const execute = process.argv.includes('--execute');
  const rebuildMissing = process.argv.includes('--rebuild-missing');
  const pruneDangling = process.argv.includes('--prune-dangling');
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

  async function objectExists(key: string): Promise<boolean> {
    try { await minioClient.statObject(bucket, key); return true; } catch { return false; }
  }
  async function downloadJson(key: string): Promise<LegacyPkg | null> {
    try {
      const stream = await minioClient.getObject(bucket, key);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as LegacyPkg;
    } catch { return null; }
  }

  // ── 模式一：--prune-dangling 悬空证据行清理（快照恢复后对象被清、DB 行残留）──
  // 范围限定开评标证据前缀；ExpertMemo.inkFileId 引用一并置空（备忘文本仍在，仅笔迹图丢失）。
  // API 面的 EVIDENCE_PROTECTED_CATEGORIES 拦的是 HTTP 删除端点；本脚本面向演示恢复场景的
  // 死引用修复，dry-run 默认 + 逐行打印。
  if (pruneDangling) {
    const EVIDENCE_PREFIXES = ['bid-opening-handover/', 'bid-evaluation-handover/', 'bid-sign-handover/',
      'bid-sign-packet/', 'opening-sign-page/', 'opening-sign-scan/', 'expert-memo/'];
    const rows = await prisma.fileAsset.findMany({
      where: { OR: EVIDENCE_PREFIXES.map(prefix => ({ key: { startsWith: prefix } })) },
      select: { id: true, key: true, category: true, originalName: true },
      orderBy: { key: 'asc' },
    });
    console.log(`证据类 FileAsset ${rows.length} 行（模式：${execute ? 'EXECUTE' : 'DRY-RUN'}）`);
    let pruned = 0;
    for (const r of rows) {
      if (await objectExists(r.key)) continue;
      const memoRefs = await prisma.expertMemo.findMany({ where: { inkFileId: r.id }, select: { id: true } });
      console.log(`✗ 悬空 ${r.key}（${r.category}）${memoRefs.length ? ` ← ExpertMemo.inkFileId ×${memoRefs.length}` : ''}`);
      if (!execute) continue;
      if (memoRefs.length > 0) {
        await prisma.expertMemo.updateMany({ where: { inkFileId: r.id }, data: { inkFileId: null } });
      }
      await prisma.fileAsset.delete({ where: { id: r.id } });
      pruned += 1;
    }
    console.log(execute ? `完成：清理悬空行 ${pruned} 行` : 'DRY-RUN 结束（--execute 生效）');
    await prisma.$disconnect();
    return;
  }

  const assets = await prisma.fileAsset.findMany({
    where: { key: { startsWith: 'bid-opening-handover/' } },
    select: { id: true, key: true },
    orderBy: { key: 'asc' },
  });
  console.log(`发现开标文件包 ${assets.length} 个（模式：${execute ? 'EXECUTE' : 'DRY-RUN'}${rebuildMissing ? ' +REBUILD-MISSING' : ''}）`);
  let touched = 0;
  for (const fa of assets) {
    const bpId = fa.key.slice('bid-opening-handover/'.length).replace(/\.json$/, '');
    try {
      let pkg = await downloadJson(fa.key);
      if (!pkg) {
        // 对象缺失（快照恢复清库场景）：--rebuild-missing 时从 DB 重建整包（v2 口径）
        if (!rebuildMissing) {
          console.log(`✗ ${bpId} 对象缺失（不在 MinIO）——加 --rebuild-missing 从 DB 重建`);
          continue;
        }
        const [project, session, suppliers, submissions, records, logs, bidRounds, hallMessages, bidSuppliers] = await Promise.all([
          prisma.bidProject.findUnique({ where: { id: bpId }, select: { id: true, projectCode: true, name: true, procurementMethod: true, openTime: true, deadline: true, stage: true, roundMode: true } }),
          prisma.bidOpeningSession.findUnique({ where: { projectId: bpId } }),
          prisma.bidSupplier.findMany({
            where: { projectId: bpId },
            select: { id: true, supplierId: true, supplierName: true, receiptNo: true, encryptStatus: true, decryptStatus: true, confirmStatus: true, submitStatus: true, dangerAttribution: true, decryptedAt: true },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.supplierBidSubmission.findMany({ where: { projectId: bpId }, select: { supplierId: true, envelopeVersion: true, decryptedAssets: true, status: true, submittedAt: true } }),
          prisma.bidOpeningRecord.findMany({
            where: { projectId: bpId },
            select: { bidSupplierId: true, supplierName: true, amount: true, amountUnit: true, period: true, qualityTarget: true, bondStatus: true, confirmStatus: true, confirmSignature: true, confirmSignedAt: true, objectionReason: true, handleResult: true },
          }),
          prisma.bidSupervisionLog.findMany({ where: { projectId: bpId }, select: { time: true, role: true, action: true, target: true, result: true, riskFlag: true }, orderBy: { time: 'asc' } }),
          prisma.bidProject.findUnique({ where: { id: bpId }, select: { roundMode: true } }).then(p => p?.roundMode
            ? prisma.bidRound.findMany({
                where: { projectId: bpId },
                include: { quotes: { select: { bidSupplierId: true, quotePrice: true, submittedAt: true, status: true } } },
                orderBy: { roundNo: 'asc' },
              })
            : []),
          prisma.openingHallMessage.findMany({
            where: { projectId: bpId }, orderBy: { createdAt: 'asc' },
            select: { roomType: true, supplierId: true, senderName: true, senderRole: true, type: true, content: true, fileAssetId: true, createdAt: true },
          }),
          prisma.bidSupplier.findMany({ where: { projectId: bpId }, select: { supplierId: true, supplierName: true } }),
        ]);
        if (!project || !session) {
          console.log(`✗ ${bpId} 项目/会话缺失，无法重建`);
          continue;
        }
        const unitMap = await resolveUnits(prisma, bpId);
        const decryptedIds = Array.from(new Set(submissions
          .filter(s => s.envelopeVersion === 'dual-v2' && s.decryptedAssets && typeof s.decryptedAssets === 'object')
          .flatMap(s => Object.values(s.decryptedAssets as Record<string, unknown>).filter((v): v is string => typeof v === 'string'))));
        const shaRows = decryptedIds.length > 0
          ? await prisma.fileAsset.findMany({ where: { id: { in: decryptedIds } }, select: { id: true, sha256: true } })
          : [];
        pkg = buildOpeningPackageFromRows({
          project, session, suppliers: suppliers as unknown as Array<Record<string, unknown>>,
          submissions, records: records as unknown as Array<Record<string, unknown>>,
          logs: logs as unknown as Array<Record<string, unknown>>,
          bidRounds: bidRounds as unknown as Array<Record<string, unknown>>,
          hallMessages,
          decryptedShaByAssetId: new Map(shaRows.map(a => [a.id, a.sha256 ?? ''])),
          unitByBsId: unitMap,
          supplierNameBySupplierId: new Map(bidSuppliers.filter(s => s.supplierId != null).map(s => [s.supplierId as string, s.supplierName])),
          now: new Date(),
        });
        console.log(`△ ${bpId} 对象缺失 → 从 DB 重建（v2：单位戳 + hallMessages ${hallMessages.length} 条；无 signatures 段——重登记开标签字时追加）`);
        if (!execute) continue; // dry-run：到此为止
        const rebuildBuffer = Buffer.from(JSON.stringify(pkg, null, 2), 'utf8');
        await minioClient.putObject(bucket, fa.key, rebuildBuffer, rebuildBuffer.length, { 'Content-Type': 'application/json' });
        const rebuildSha = crypto.createHash('sha256').update(rebuildBuffer).digest('hex');
        await prisma.fileAsset.update({ where: { id: fa.id }, data: { size: rebuildBuffer.length, sha256: rebuildSha } });
        touched += 1;
        console.log(`    已重建上传 + FileAsset 指纹刷新（sha256 ${rebuildSha.slice(0, 16)}…）`);
        continue;
      }
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
