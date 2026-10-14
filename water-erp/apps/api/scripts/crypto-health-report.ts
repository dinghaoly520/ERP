/**
 * 密文体系体检报告（只读巡检 · 2026-10-14 方向一「对账+供给」配套）
 *
 * 背景：2026-10-14 一键通知 500 排查证明——钥供给与库内密文实况无对账机制，
 * 孤儿 keyId（d8ded1a4·旧钥已失）只能靠人肉 SQL+/proc 排查。本脚本把该排查
 * 产品化：一键输出五轨密文健康状态，非零退出码供 cron/CI 用。
 *
 * 覆盖：
 *   1. 密钥配置状态（FIELD_ENC_SECRET[_OLD] keyId、KMS/PASSWORD_VIEW/JWT 在否、
 *      dev 回退钥激活告警）——只显示 keyId/布尔，绝不回显密钥值
 *   2. PII 国密轨（sm1:）：PII_SEAL_MAP 各列 null/空/密文(keyId 分布)/明文残留；
 *      孤儿 keyId = 不在 {active, OLD} 内
 *   3. 投标报价轨（v1:AES·KMS 派生）：SupplierBidSubmission.bidPrice 分布
 *   4. 上传密封轨：FileAsset.sealedKey 覆盖率
 *   5. 双信封轨：envelope version 分布
 *   6. 盲索引一致性：3 个 *Idx 列 vs openPiiForMask 重算值
 *
 * 判定（退出码 1 的红灯项）：PII 明文残留 / 孤儿 keyId / 盲索引失配。
 * v1: 与 envelope 明文兼容态为设计内宽容（不红灯，仅列示）。
 *
 * 用法：npx tsx scripts/crypto-health-report.ts（任意 cwd，自载 apps/api/.env）
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { openPiiForMask, blindIndexPii, fieldKeyId, activeFieldKeyId, isSealedFieldSm } from '../src/common/crypto/sm-field-crypto';

// ── .env 加载（先于任何 crypto 调用）──
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
loadEnvFile([join(process.cwd(), 'apps', 'api', '.env'), join(scriptDir, '..', '.env')]);

const prisma = new PrismaClient();
let red = 0;
const redLines: string[] = [];
function flagRed(line: string) {
  red++;
  redLines.push(line);
}

/** 与 prisma/seed.ts / seal-existing-pii.ts 单一口径——改映射须三处同步 */
const PII_SEAL_MAP: Record<string, Array<{ field: string; idx?: string }>> = {
  User: [{ field: 'email' }, { field: 'phone', idx: 'phoneIdx' }],
  ExpertProfile: [{ field: 'phone' }, { field: 'idNumber' }, { field: 'licenseNo' }],
  Supplier: [{ field: 'legalPersonIdCard', idx: 'legalPersonIdCardIdx' }, { field: 'legalPersonPhone' }],
  SupplierContact: [{ field: 'phone' }, { field: 'idCard', idx: 'idCardIdx' }, { field: 'email' }],
};

const keyIdOf = (v: string) => v.split(':')[1];

async function main() {
  // ── 1. 密钥配置状态 ──
  const active = process.env.FIELD_ENC_SECRET || null;
  const old = process.env.FIELD_ENC_SECRET_OLD || null;
  // 生效钥集（含 dev 回退兜底）：孤儿判定必须对齐 openPii 实际能解的钥——
  // 2026-10-14 教训：曾按 fieldKeyId(env||'') 空串指纹判孤儿，把回退钥密文全误报
  const effectiveActiveKeyId = activeFieldKeyId();
  const knownKeyIds = new Set<string>([effectiveActiveKeyId, old ? fieldKeyId(old) : null].filter(Boolean) as string[]);
  console.log('══ 1. 密钥配置状态 ══');
  console.log(`  FIELD_ENC_SECRET      ${active ? `已配置 keyId=${fieldKeyId(active)}（len=${active.length}）` : `❌ 未配置（dev 回退钥 keyId=${effectiveActiveKeyId} 激活）`}`);
  console.log(`  FIELD_ENC_SECRET_OLD  ${old ? `已配置 keyId=${fieldKeyId(old)}` : '未配置（无旧钥读窗口）'}`);
  if (!active) flagRed('FIELD_ENC_SECRET 未配置——库内新密封持续用公开 dev 回退钥');
  for (const k of ['KMS_SECRET', 'PASSWORD_VIEW_SECRET', 'JWT_SECRET']) {
    console.log(`  ${k.padEnd(21)} ${process.env[k] ? '已配置' : '未配置'}`);
  }

  // ── 2. PII 国密轨 ──
  console.log('\n══ 2. PII 国密轨（sm1:）══');
  for (const [model, fields] of Object.entries(PII_SEAL_MAP)) {
    const delegate = (prisma as any)[model[0].toLowerCase() + model.slice(1)];
    for (const { field } of fields) {
      const rows: Array<Record<string, string | null>> = await delegate.findMany({ select: { id: true, [field]: true } });
      let nul = 0, empty = 0, plain = 0;
      const byKeyId = new Map<string, number>();
      for (const r of rows) {
        const v = r[field];
        if (v == null) nul++;
        else if (v === '') empty++;
        else if (isSealedFieldSm(v)) byKeyId.set(keyIdOf(v), (byKeyId.get(keyIdOf(v)) ?? 0) + 1);
        else plain++;
      }
      const keyPart = [...byKeyId.entries()].map(([k, n]) => `${k}:${n}`).join(' ') || '—';
      console.log(`  ${model}.${field.padEnd(19)} null=${nul} 空=${empty} 密文[${keyPart}] 明文=${plain}`);
      if (plain > 0) flagRed(`${model}.${field} 明文残留 ${plain} 条`);
      for (const k of byKeyId.keys()) {
        if (!knownKeyIds.has(k)) flagRed(`${model}.${field} 孤儿 keyId ${k}（当前钥集解不开，行数 ${byKeyId.get(k)}）`);
      }
    }
  }

  // ── 3. 投标报价轨（v1:AES）──
  console.log('\n══ 3. 投标报价轨（v1:AES · KMS 派生）══');
  const subs = await prisma.supplierBidSubmission.findMany({ select: { bidPrice: true, envelope: true } });
  const v1 = subs.filter((s) => (s.bidPrice ?? '').startsWith('v1:')).length;
  const bpPlain = subs.filter((s) => s.bidPrice != null && s.bidPrice !== '' && !(s.bidPrice ?? '').startsWith('v1:')).length;
  console.log(`  SupplierBidSubmission（${subs.length} 行）  bidPrice: v1密文=${v1} 明文/兼容=${bpPlain} null=${subs.length - v1 - bpPlain}（无前缀直通为设计内宽容）`);

  // ── 5. 双信封轨 ──
  console.log('\n══ 4. 双信封轨 ══');
  const envStat = new Map<string, number>();
  for (const s of subs) {
    const ver = (s.envelope as any)?.version ?? '旧轨(null)';
    envStat.set(ver, (envStat.get(ver) ?? 0) + 1);
  }
  console.log(`  envelope 版本分布: ${[...envStat.entries()].map(([k, n]) => `${k}:${n}`).join(' ') || '—'}`);

  // ── 4. 上传密封轨 ──
  console.log('\n══ 5. 上传密封轨 ══');
  const [faTotal, faSealed] = await Promise.all([
    prisma.fileAsset.count(),
    prisma.fileAsset.count({ where: { sealedKey: { not: null } } }),
  ]);
  console.log(`  FileAsset ${faTotal} 个，sealedKey 已封 ${faSealed}（UPLOAD_SERVER_SEAL 类目才封，未封≠异常）`);

  // ── 6. 盲索引一致性 ──
  console.log('\n══ 6. 盲索引一致性 ══');
  const idxChecks: Array<{ model: string; valueField: string; idxField: string }> = [
    { model: 'User', valueField: 'phone', idxField: 'phoneIdx' },
    { model: 'Supplier', valueField: 'legalPersonIdCard', idxField: 'legalPersonIdCardIdx' },
    { model: 'SupplierContact', valueField: 'idCard', idxField: 'idCardIdx' },
  ];
  for (const { model, valueField, idxField } of idxChecks) {
    const delegate = (prisma as any)[model[0].toLowerCase() + model.slice(1)];
    const rows: Array<Record<string, string | null>> = await delegate.findMany({ select: { [valueField]: true, [idxField]: true } });
    let ok = 0, mismatch = 0, skipped = 0, failed = 0;
    for (const r of rows) {
      const v = r[valueField];
      if (v == null || v === '') { skipped++; continue; }
      try {
        const plain = openPiiForMask(v);
        const expect = plain == null || plain === '' ? null : blindIndexPii(plain);
        if (expect === r[idxField]) ok++; else mismatch++;
      } catch { failed++; }
    }
    console.log(`  ${model}.${idxField.padEnd(21)} 一致=${ok} 失配=${mismatch} 空值跳过=${skipped} 拆封失败=${failed}`);
    if (mismatch > 0) flagRed(`${model}.${idxField} 盲索引失配 ${mismatch} 条（换 active 钥后未重算→查重静默失效）`);
    if (failed > 0) flagRed(`${model}.${idxField} 拆封失败 ${failed} 条（孤儿密文）`);
  }

  // ── 汇总 ──
  console.log('\n══ 汇总 ══');
  if (red === 0) {
    console.log('✅ 全绿：无明文残留、无孤儿 keyId、盲索引一致。');
  } else {
    console.log(`🔴 红灯 ${red} 项：`);
    for (const l of redLines) console.log(`  - ${l}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
