/**
 * 盲索引全量重算脚本（密钥轮转配套 · 2026-10-12 密文评估 P1-3）
 *
 * 背景：PII 国密列（sm1:）的盲索引（HMAC-SM3，等值查重用）只用 **active** 钥派生
 * （blindIndexPii 无 OLD 支持——与 sm1 密文的 keyId 自描述轮转不对称）。因此
 * FIELD_ENC_SECRET 轮转后，存量 *Idx 列与新算索引失配 → 查重静默失效
 * （重复手机号可注册、法人身份证可重复入库）且无任何报错。
 *
 * 本脚本是轮转 runbook 的硬性步骤（docs/crypto-key-rotation-runbook.md）：
 *
 *   前提：FIELD_ENC_SECRET 已换新钥，FIELD_ENC_SECRET_OLD=旧钥（读旧密文用）
 *   动作：逐行 openPiiForMask 拆封（宽容：sealed 用 keyId 选钥，含 OLD；
 *         legacy 明文直通）→ blindIndexPii（新 active 钥）→ 差异更新 *Idx 列
 *
 *   覆盖三列：
 *     User.phoneIdx             （注册/登录手机号查重）
 *     Supplier.legalPersonIdCardIdx（法人身份证唯一性）
 *     SupplierContact.idCardIdx （联系人身份证冲突校验）
 *
 *   dry-run 与 --execute 同逻辑（只读 vs 写库）；单行拆封/更新失败不中断，
 *   失败行汇总列出（人工核查后重跑即可——幂等）。
 *
 * 用法：
 *   npx tsx apps/api/scripts/recompute-pii-blind-index.ts           # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/recompute-pii-blind-index.ts --execute # 真实重算写库
 *
 * 环境：脚本自行加载 apps/api/.env（DATABASE_URL / FIELD_ENC_SECRET[_OLD]），
 * 从 water-erp/ 根或 apps/api/ 目录运行均可。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { openPiiForMask, blindIndexPii, fieldKeyId } from '../src/common/crypto/sm-field-crypto';

// ── .env 加载（先于任何 crypto 调用——activeSecret 读 FIELD_ENC_SECRET）──
function loadEnvFile(candidates: string[]): string | null {
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = value; // dotenv 语义：不覆盖已有
    }
    return p;
  }
  return null;
}

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
const loadedEnv = loadEnvFile([
  join(process.cwd(), 'apps', 'api', '.env'), // 从 water-erp/ 根运行
  join(scriptDir, '..', '.env'), // 从 apps/api/ 运行（scripts/ 的上级）
]);
if (!loadedEnv) {
  console.error('未找到 apps/api/.env（DATABASE_URL / FIELD_ENC_SECRET 必需）');
  process.exit(1);
}

const EXECUTE = process.argv.includes('--execute');
const prisma = new PrismaClient();

type Row = { model: string; id: string; detail: string };
const recomputed: Row[] = [];
const unchanged: string[] = [];
const failed: Row[] = [];

/** 分页遍历（游标式，避免一次性物化全表） */
async function* paginate<T>(
  total: number,
  page: (cursor: string | null) => Promise<T[]>,
  idOf: (t: T) => string,
): AsyncGenerator<T> {
  let cursor: string | null = null;
  while (true) {
    const rows = await page(cursor);
    if (rows.length === 0) break;
    for (const r of rows) yield r;
    if (rows.length < total) break;
    cursor = idOf(rows[rows.length - 1]);
  }
}

async function main() {
  console.log(`盲索引重算 ${EXECUTE ? '【EXECUTE·写库】' : '【dry-run·零副作用】'}`);
  console.log(`active keyId=${fieldKeyIdOf()} oldKeyId=${process.env.FIELD_ENC_SECRET_OLD ? '已配置' : '未配置（无旧钥可读旧密文）'}\n`);

  // 1. User.phoneIdx
  for await (const u of paginate(
    500,
    (cursor) =>
      prisma.user.findMany({
        where: { phone: { not: null } },
        select: { id: true, phone: true, phoneIdx: true },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      }),
    (u) => u.id,
  )) {
    try {
      const plain = openPiiForMask(u.phone);
      const idx = plain == null || plain === '' ? null : blindIndexPii(plain);
      if (idx === u.phoneIdx) unchanged.push(`User:${u.id}`);
      else {
        recomputed.push({ model: 'User', id: u.id, detail: `phoneIdx ${short(u.phoneIdx)} → ${short(idx)}` });
        if (EXECUTE) await prisma.user.update({ where: { id: u.id }, data: { phoneIdx: idx } });
      }
    } catch (e) {
      failed.push({ model: 'User', id: u.id, detail: (e as Error).message });
    }
  }

  // 2. Supplier.legalPersonIdCardIdx
  for await (const s of paginate(
    500,
    (cursor) =>
      prisma.supplier.findMany({
        where: { legalPersonIdCard: { not: null } },
        select: { id: true, legalPersonIdCard: true, legalPersonIdCardIdx: true },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      }),
    (s) => s.id,
  )) {
    try {
      const plain = openPiiForMask(s.legalPersonIdCard);
      const idx = plain == null || plain === '' ? null : blindIndexPii(plain);
      if (idx === s.legalPersonIdCardIdx) unchanged.push(`Supplier:${s.id}`);
      else {
        recomputed.push({ model: 'Supplier', id: s.id, detail: `legalPersonIdCardIdx ${short(s.legalPersonIdCardIdx)} → ${short(idx)}` });
        if (EXECUTE) await prisma.supplier.update({ where: { id: s.id }, data: { legalPersonIdCardIdx: idx } });
      }
    } catch (e) {
      failed.push({ model: 'Supplier', id: s.id, detail: (e as Error).message });
    }
  }

  // 3. SupplierContact.idCardIdx
  for await (const c of paginate(
    500,
    (cursor) =>
      prisma.supplierContact.findMany({
        where: { idCard: { not: null } },
        select: { id: true, idCard: true, idCardIdx: true },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      }),
    (c) => c.id,
  )) {
    try {
      const plain = openPiiForMask(c.idCard);
      const idx = plain == null || plain === '' ? null : blindIndexPii(plain);
      if (idx === c.idCardIdx) unchanged.push(`SupplierContact:${c.id}`);
      else {
        recomputed.push({ model: 'SupplierContact', id: c.id, detail: `idCardIdx ${short(c.idCardIdx)} → ${short(idx)}` });
        if (EXECUTE) await prisma.supplierContact.update({ where: { id: c.id }, data: { idCardIdx: idx } });
      }
    } catch (e) {
      failed.push({ model: 'SupplierContact', id: c.id, detail: (e as Error).message });
    }
  }

  // ── 汇总 ──
  console.log(`扫描合计 ${unchanged.length + recomputed.length + failed.length} 行：`);
  console.log(`  一致无需重算 ${unchanged.length}`);
  console.log(`  ${EXECUTE ? '已重算' : '待重算（dry-run）'} ${recomputed.length}`);
  for (const r of recomputed) console.log(`    [${r.model}] ${r.id} ${r.detail}`);
  console.log(`  失败 ${failed.length}`);
  for (const f of failed) console.log(`    [${f.model}] ${f.id} ${f.detail}`);

  if (failed.length > 0) {
    console.log('\n存在失败行：常见原因为密文 MAC 校验失败或 keyId 无对应密钥（FIELD_ENC_SECRET_OLD 未配置/配错）。');
    console.log('轮转完成判据 = 本脚本零失败且重算清零后重跑 dry-run 无待重算行。');
  }
  if (!EXECUTE && recomputed.length > 0) {
    console.log('\n以上为 dry-run 清单；确认后加 --execute 写库。');
  }
}

/** 展示用短指纹（索引本身不敏感，但仍只显示前后段便于人工比对） */
function short(v: string | null): string {
  if (!v) return 'null';
  return `${v.slice(0, 8)}…${v.slice(-6)}`;
}

function fieldKeyIdOf(): string {
  return fieldKeyId(process.env.FIELD_ENC_SECRET || '');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
