/**
 * PII 国密密封存量回填脚本（2026-10-14 · 一键通知 500 修复配套）
 *
 * 背景：2026-10-09 服务层读端全改严格 openPii（cc2d143a），而当前库最后播种
 * 于同日 10:29 的种子密封化（8724a1ce「重建后库内全密文」）之前，且无字段级
 * 回填——存量明文行令一切功能性解密（通知取号/揭示/审计）抛
 * 「未识别的字段密文格式（缺少 sm1:keyId: 前缀）」500。实测明文分布：
 * SupplierContact.phone 246 / ExpertProfile.idNumber 187 / ExpertProfile.phone 186 …
 *
 * 动作：按 seed.ts 的 PII_SEAL_MAP（单一口径，改映射须两处同步）逐列扫描，
 * 明文行 sealPii 原地密封 + 同步回填 *Idx 盲索引（与种子装载行为一致）；
 * 已密封行跳过（幂等）。不打印任何明文值，只输出行 id 与计数。
 *
 * 密钥：走 sealPii/openPii 同一 activeSecret 解析（FIELD_ENC_SECRET，未配置回退
 * dev 钥并告警）——与运行中的 API 同源同钥，密封后 API 即刻可解。脚本启动时
 * 比对已密封行的内嵌 keyId 与 active keyId，不一致立即告警（防轮转期错钥封存）。
 *
 * 用法：
 *   npx tsx apps/api/scripts/seal-existing-pii.ts           # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/seal-existing-pii.ts --execute # 真实密封写库
 *
 * 验收判据：execute 后重跑 dry-run 全表「待密封 0」，且
 * recompute-pii-blind-index.ts dry-run 无待重算行。
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { sealPii, blindIndexPii, isSealedFieldSm, fieldKeyId } from '../src/common/crypto/sm-field-crypto';

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

/** 与 prisma/seed.ts PII_SEAL_MAP 单一口径——改映射须两处同步 */
const PII_SEAL_MAP: Record<string, Array<{ field: string; idx?: string }>> = {
  User: [{ field: 'email' }, { field: 'phone', idx: 'phoneIdx' }],
  ExpertProfile: [{ field: 'phone' }, { field: 'idNumber' }, { field: 'licenseNo' }],
  Supplier: [{ field: 'legalPersonIdCard', idx: 'legalPersonIdCardIdx' }, { field: 'legalPersonPhone' }],
  SupplierContact: [{ field: 'phone' }, { field: 'idCard', idx: 'idCardIdx' }, { field: 'email' }],
};

type FieldStat = { model: string; field: string; sealedSkip: number; pending: number; done: number; failed: number; sampleIds: string[] };
const stats: FieldStat[] = [];
const failedRows: Array<{ model: string; id: string; field: string; error: string }> = [];
const foreignKeyIds = new Set<string>(); // 已密封行内嵌 keyId（与 active 比对防错钥）

/** 分页遍历（游标式，避免一次性物化全表；更新不改 id，游标安全） */
async function* paginate<T>(
  pageSize: number,
  page: (cursor: string | null) => Promise<T[]>,
  idOf: (t: T) => string,
): AsyncGenerator<T> {
  let cursor: string | null = null;
  while (true) {
    const rows = await page(cursor);
    if (rows.length === 0) break;
    for (const r of rows) yield r;
    if (rows.length < pageSize) break;
    cursor = idOf(rows[rows.length - 1]);
  }
}

async function main() {
  const activeKeyId = fieldKeyId(process.env.FIELD_ENC_SECRET || '');
  console.log(`PII 存量密封回填 ${EXECUTE ? '【EXECUTE·写库】' : '【dry-run·零副作用】'}`);
  console.log(`active keyId=${activeKeyId}（FIELD_ENC_SECRET ${process.env.FIELD_ENC_SECRET ? '已配置' : '未配置·dev 回退钥'}）\n`);

  for (const [model, fields] of Object.entries(PII_SEAL_MAP)) {
    const delegate = (prisma as any)[model[0].toLowerCase() + model.slice(1)];
    if (!delegate) {
      console.error(`Prisma delegate 不存在: ${model}`);
      process.exitCode = 1;
      return;
    }
    for (const { field, idx } of fields) {
      const stat: FieldStat = { model, field, sealedSkip: 0, pending: 0, done: 0, failed: 0, sampleIds: [] };
      for await (const row of paginate(
        500,
        (cursor) =>
          delegate.findMany({
            // 不加 null 过滤：SupplierContact.phone 等列为 NOT NULL，Prisma 拒绝
            // 对非空列写 not:null；表均数百行量级，全量取回由下方 JS 过滤
            select: { id: true, [field]: true },
            take: 500,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            orderBy: { id: 'asc' },
          }),
        (r: any) => r.id,
      )) {
        const v: string | null = row[field];
        if (v == null || v === '') continue; // null/空串非 PII，种子口径原样保留
        if (isSealedFieldSm(v)) {
          stat.sealedSkip++;
          foreignKeyIds.add(v.split(':')[1]);
          continue;
        }
        stat.pending++;
        if (stat.sampleIds.length < 10) stat.sampleIds.push(row.id);
        if (!EXECUTE) continue;
        try {
          const plain = v; // 明文在手才走到这里——seal 后不可再取
          const data: Record<string, string | null> = { [field]: sealPii(plain)! };
          if (idx) data[idx] = blindIndexPii(plain); // 与 seed 装载行为一致：密封同时回填盲索引
          await delegate.update({ where: { id: row.id }, data });
          stat.done++;
        } catch (e) {
          stat.failed++;
          failedRows.push({ model, id: row.id, field, error: (e as Error).message });
        }
      }
      stats.push(stat);
    }
  }

  // ── 汇总 ──
  console.log('扫描结果（按表.列）：');
  let totalPending = 0;
  for (const s of stats) {
    totalPending += s.pending;
    const parts = [`已密封跳过 ${s.sealedSkip}`, `${EXECUTE ? '已密封' : '待密封'} ${s.pending}`];
    if (EXECUTE) parts.push(`失败 ${s.failed}`);
    console.log(`  ${s.model}.${s.field.padEnd(20)} ${parts.join(' / ')}`);
    if (!EXECUTE && s.pending > 0) console.log(`    示例行 id: ${s.sampleIds.join(', ')}${s.pending > 10 ? ' …' : ''}`);
  }
  if (failedRows.length > 0) {
    console.log(`\n失败 ${failedRows.length} 行（不中断，人工核查后重跑即可——幂等）：`);
    for (const f of failedRows) console.log(`    [${f.model}] ${f.id} ${f.field}: ${f.error}`);
  }
  const mismatch = [...foreignKeyIds].filter((k) => k !== activeKeyId);
  if (mismatch.length > 0) {
    console.warn(`\n⚠ 库内已存在非 active keyId 的密文（${mismatch.join(', ')}）——若非刻意的轮转期旧密文，请检查 FIELD_ENC_SECRET 是否与写入时一致后再执行。`);
  }
  if (!EXECUTE && totalPending > 0) {
    console.log('\n以上为 dry-run 清单；确认后加 --execute 写库。');
  }
  if (EXECUTE) {
    console.log(totalPending === 0 ? '\n无待密封行，库内已全密文。' : `\n完成：${totalPending} 行待密封中 ${stats.reduce((n, s) => n + s.done, 0)} 行已密封，${failedRows.length} 行失败。`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
