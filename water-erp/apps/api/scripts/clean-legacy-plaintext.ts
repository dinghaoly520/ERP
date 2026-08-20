/**
 * 存量投标明文清理脚本（dual-envelope 收口 · Phase 4 · Task 19）
 *
 * 背景：旧轨「服务端代加密」分支（supplier-portal.service.ts 投递时）把供应商上传的
 * 明文留在 FileAsset.key，密文另存 FileAsset.sealedPath，并置 encrypted=true（
 * clientEncrypted=false）。开标解密/AI 分析读密文（sealedPath || key 回退），
 * 明文对象自 sealedPath 落盘起即冗余。本脚本移除这些遗留明文对象：
 *
 *   候选集  fileAsset WHERE encrypted = true AND clientEncrypted = false
 *   可清理  被 status='submitted' 的 SupplierBidSubmission 通过四列
 *           technicalFileAssetId / businessFileAssetId / coverLetterAssetId /
 *           bidBondAssetId 引用，且 asset.sealedPath 非空（密文副本存在）。
 *           —— 草稿/撤回引用的资产不动（投递时会被新轨拒收、重新加密上传）；
 *           —— sealedPath 为空的资产（如 bid_inner_ciphertext 服务端中间密文）
 *              的 asset.key 是唯一副本，一律跳过并告警。
 *
 * 用法：
 *   npx tsx apps/api/scripts/clean-legacy-plaintext.ts           # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/clean-legacy-plaintext.ts --execute # 真实删除 + 标记翻转
 *
 * --execute 语义：
 *   - minioClient.removeObject(bucket, asset.key)：删除明文对象；
 *   - fileAsset.update({ encrypted: false })：encrypted 翻 false 表示
 *     「明文对象已移除」（sealedPath 密文保留、sealedKey 不动，开标解密不受影响）；
 *   - 逐条 try/catch：单行失败不中断，失败行保持 encrypted=true 原样；
 *   - 无交互确认——命令行 --execute 参数即确认（真实删除请审阅 dry-run 清单后再执行）。
 *
 * 环境：脚本自行加载 apps/api/.env（DATABASE_URL / MINIO_*），
 * 从 water-erp/ 根或 apps/api/ 目录运行均可。
 */
import { PrismaClient } from '@prisma/client';
import { Client } from 'minio';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── .env 加载（先于 PrismaClient / MinIO Client 实例化）──
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
  join(process.cwd(), '.env'), // 从 apps/api 运行
  join(scriptDir, '..', '.env'), // 脚本自身位置兜底
]);

const prisma = new PrismaClient();

// 与 src/upload/minio.client.ts 相同的环境回退（不 import Nest 模块，避免装饰器依赖）
const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'water_erp_minio',
  secretKey: process.env.MINIO_SECRET_KEY || 'water_erp_minio_dev',
});
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'water-erp';

type RoleCol = {
  role: string;
  assetIdCol:
    | 'technicalFileAssetId'
    | 'businessFileAssetId'
    | 'coverLetterAssetId'
    | 'bidBondAssetId';
  sealedKeyCol?:
    | 'technicalSealedKey'
    | 'businessSealedKey'
    | 'coverLetterSealedKey';
};

// 四列文件引用（bidBond 无 sealedKey——程序性文件不加密，仅防御性纳入 join）
const ROLE_COLS: RoleCol[] = [
  { role: 'technical', assetIdCol: 'technicalFileAssetId', sealedKeyCol: 'technicalSealedKey' },
  { role: 'business', assetIdCol: 'businessFileAssetId', sealedKeyCol: 'businessSealedKey' },
  { role: 'coverLetter', assetIdCol: 'coverLetterAssetId', sealedKeyCol: 'coverLetterSealedKey' },
  { role: 'bidBond', assetIdCol: 'bidBondAssetId' },
];

type Ref = {
  submissionId: string;
  projectId: string;
  status: string;
  role: string;
  sealedKey: string | null;
};

const bar = '─'.repeat(96);

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

async function main() {
  const execute = process.argv.includes('--execute');

  console.log(bar);
  console.log(
    execute
      ? '  存量投标明文清理 · EXECUTE（将从 MinIO 删除明文对象并翻转 encrypted 标记）'
      : '  存量投标明文清理 · DRY-RUN（只读：不删除对象、不更新数据库）',
  );
  console.log('  候选集: fileAsset WHERE encrypted=true AND clientEncrypted=false');
  console.log('  可清理: 被 submitted 标书四列引用 且 sealedPath 非空（密文副本存在）');
  if (loadedEnv) console.log(`  env: ${loadedEnv}`);
  console.log(bar);

  // ── 候选资产 ──
  const candidates = await prisma.fileAsset.findMany({
    where: { encrypted: true, clientEncrypted: false },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n候选资产（encrypted=true, clientEncrypted=false）: ${candidates.length} 个`);

  // ── submission 引用（全状态；submitted 才可清理，其余仅用于跳过清单标注）──
  const submissions = await prisma.supplierBidSubmission.findMany({
    select: {
      id: true,
      projectId: true,
      status: true,
      technicalFileAssetId: true,
      businessFileAssetId: true,
      coverLetterAssetId: true,
      bidBondAssetId: true,
      technicalSealedKey: true,
      businessSealedKey: true,
      coverLetterSealedKey: true,
    },
  });

  const refsByAsset = new Map<string, Ref[]>();
  for (const s of submissions) {
    for (const col of ROLE_COLS) {
      const assetId = s[col.assetIdCol];
      if (!assetId) continue;
      const sealedKey = col.sealedKeyCol ? (s[col.sealedKeyCol] ?? null) : null;
      const list = refsByAsset.get(assetId) ?? [];
      list.push({
        submissionId: s.id,
        projectId: s.projectId,
        status: s.status,
        role: col.role,
        sealedKey,
      });
      refsByAsset.set(assetId, list);
    }
  }

  // ── 分区 ──
  type Row = {
    asset: (typeof candidates)[number];
    refs: Ref[];
    submittedRefs: Ref[];
    skipReason: 'ELIGIBLE' | 'NO_SEALED_PATH' | 'DRAFT_REF' | 'UNREFERENCED';
  };
  const rows: Row[] = candidates.map((asset) => {
    const refs = refsByAsset.get(asset.id) ?? [];
    const submittedRefs = refs.filter((r) => r.status === 'submitted');
    const draftRefs = refs.filter((r) => r.status !== 'submitted');
    let skipReason: Row['skipReason'];
    if (!asset.sealedPath) {
      skipReason = 'NO_SEALED_PATH'; // asset.key 是唯一副本，删=数据丢失
    } else if (submittedRefs.length > 0) {
      skipReason = 'ELIGIBLE';
    } else if (draftRefs.length > 0) {
      skipReason = 'DRAFT_REF';
    } else {
      skipReason = 'UNREFERENCED';
    }
    return { asset, refs, submittedRefs, skipReason };
  });

  const eligible = rows.filter((r) => r.skipReason === 'ELIGIBLE');
  const noSealedPath = rows.filter((r) => r.skipReason === 'NO_SEALED_PATH');
  const draftRef = rows.filter((r) => r.skipReason === 'DRAFT_REF');
  const unreferenced = rows.filter((r) => r.skipReason === 'UNREFERENCED');

  console.log(`  可清理（submitted 引用 + sealedPath 存在）: ${eligible.length} 个`);
  console.log(`  跳过 · sealedPath 缺失（asset.key 是唯一副本）: ${noSealedPath.length} 个`);
  console.log(`  跳过 · 仅草稿/撤回引用: ${draftRef.length} 个`);
  console.log(`  跳过 · 无 submission 引用: ${unreferenced.length} 个`);

  // ── 可清理清单 ──
  if (eligible.length > 0) {
    console.log(`\n${bar}`);
    console.log('可清理清单（每行 = 一个引用；同一资产被多份标书引用则多行，删除只执行一次）:');
    console.log(bar);
    const head = [
      pad('#', 3),
      pad('assetId', 26),
      pad('size', 10),
      pad('role', 12),
      pad('sealedKey', 9),
      pad('category', 22),
      pad('submissionId', 26),
      pad('projectId', 26),
      'key',
    ].join(' ');
    console.log(head);
    console.log(bar);
    let i = 0;
    for (const row of eligible) {
      for (const ref of row.submittedRefs) {
        i += 1;
        console.log(
          [
            pad(String(i), 3),
            pad(row.asset.id, 26),
            pad(String(row.asset.size), 10),
            pad(ref.role, 12),
            pad(ref.sealedKey ? '有' : '无', 9),
            pad(row.asset.category, 22),
            pad(ref.submissionId, 26),
            pad(ref.projectId, 26),
            row.asset.key,
          ].join(' '),
        );
      }
      if (row.refs.some((r) => r.status !== 'submitted')) {
        console.log(`  ↑ 该资产同时被非 submitted 标书引用（清理后其引用方不可再下载明文）`);
      }
    }
  }

  // ── 跳过清单 ──
  for (const [label, group] of [
    ['sealedPath 缺失（仅存明文，删除=数据丢失，永不清理）', noSealedPath],
    ['仅草稿/撤回引用（投递时将被新轨拒收重传，不动）', draftRef],
    ['无 submission 引用（含服务端中间密文/孤儿）', unreferenced],
  ] as const) {
    if (group.length === 0) continue;
    console.log(`\n${bar}`);
    console.log(`跳过 · ${label}: ${group.length} 个`);
    console.log(bar);
    for (const row of group) {
      const refNote = row.refs
        .slice(0, 3)
        .map((r) => `${r.role}@${r.status}(${r.submissionId})`)
        .join(', ');
      console.log(
        `  ${pad(row.asset.id, 26)} ${pad(row.asset.category, 22)} ${pad(String(row.asset.size), 10)} key=${row.asset.key}${refNote ? ` refs=[${refNote}${row.refs.length > 3 ? ', …' : ''}]` : ''}`,
      );
    }
  }

  // ── dry-run 到此为止 ──
  if (!execute) {
    console.log(`\n${bar}`);
    console.log('DRY-RUN 结束：未删除任何对象、未更新任何数据。');
    console.log('核对清单后，加 --execute 执行真实删除（密文 sealedPath 保留）。');
    console.log(bar);
    await prisma.$disconnect();
    return;
  }

  // ── EXECUTE ──
  console.log(`\n${bar}`);
  console.log('[WARN] EXECUTE 模式：即将从 MinIO 删除以上可清理资产对应的明文对象。');
  console.log('[WARN] 密文 sealedPath 保留、encrypted 翻 false（明文对象已移除）；此操作不可逆。');
  console.log('[WARN] 逐条失败不中断；失败行保持 encrypted=true 原样。');
  console.log(bar);

  if (eligible.length === 0) {
    console.log('无可清理资产，执行结束。');
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let failed = 0;
  const failedKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of eligible) {
    if (seen.has(row.asset.id)) continue; // 多引用只删一次
    seen.add(row.asset.id);
    try {
      await minioClient.removeObject(MINIO_BUCKET, row.asset.key);
    } catch (e) {
      failed += 1;
      failedKeys.push(row.asset.key);
      console.log(`  [FAIL] removeObject ${row.asset.key}: ${(e as Error).message}（encrypted 保持 true）`);
      continue; // 对象仍在 → 不翻标记
    }
    try {
      await prisma.fileAsset.update({
        where: { id: row.asset.id },
        // encrypted=false 语义：明文对象已移除（sealedPath 密文保留，开标解密走 sealedPath）
        data: { encrypted: false },
      });
      ok += 1;
      console.log(`  [OK]   ${row.asset.key}  明文已删，encrypted=false`);
    } catch (e) {
      failed += 1;
      failedKeys.push(row.asset.key);
      console.log(
        `  [CRIT] ${row.asset.key}: 对象已删除但 DB 标记更新失败（encrypted 仍为 true，语义=明文对象已移除需手工核对）: ${(e as Error).message}`,
      );
    }
  }

  console.log(`\n${bar}`);
  console.log('EXECUTE 汇总:');
  console.log(`  成功（明文已删 + encrypted=false）: ${ok}`);
  console.log(`  失败（保持原样，需人工跟进）: ${failed}`);
  if (failedKeys.length > 0) console.log(`  失败对象: ${failedKeys.join(' | ')}`);
  console.log(bar);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
