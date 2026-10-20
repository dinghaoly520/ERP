/** 诊断：三真实供应商 dual-v3 投递 FILE_NOT_OWNED —— 暂存资产归属 vs 信封引用对账 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const NAMES = ['自贡市烨友腾隽汽车销售有限公司', '成都世纪远景汽车贸易有限公司', '四川弘沣汽车服务有限责任公司'];

async function main() {
  const sups = await p.supplier.findMany({
    where: { name: { in: NAMES } },
    select: { id: true, name: true, userId: true },
  });
  const byId = new Map(sups.map(s => [s.id, s]));
  const userIds = sups.map(s => s.userId);

  // ① 三家名下 FileAsset（近期全部）
  const assets = await p.fileAsset.findMany({
    where: { uploaderId: { in: userIds } },
    select: { id: true, category: true, originalName: true, uploaderId: true, createdAt: true, size: true },
    orderBy: { createdAt: 'desc' }, take: 30,
  });
  console.log(`━━ 三家名下 FileAsset ${assets.length} 条:`);
  for (const a of assets) {
    const owner = sups.find(s => s.userId === a.uploaderId)!.name.slice(0, 5);
    console.log(`  ${a.createdAt.toISOString().slice(5, 19)} ${a.category} "${a.originalName}" id=${a.id} size=${a.size} 上传者=${owner}`);
  }

  // ② 三家的 CaOperation（含 submit 语义的）+ 冻结载荷里的 assetId
  const ops = await p.$queryRawUnsafe(
    `SELECT id, "subjectId", purpose, status, "createdAt", "updatedAt", result::text AS payloadText
     FROM "CaOperation" WHERE "subjectId" = ANY($1::text[]) ORDER BY "updatedAt" DESC LIMIT 12`,
    sups.map(s => s.id),
  );
  console.log(`\n━━ CaOperation ${ops.length} 条:`);
  for (const o of ops) {
    const name = byId.get(o.subjectId)!.name.slice(0, 5);
    let assetIds: string[] = [];
    try {
      const payload = o.payloadText && o.payloadText !== "null" ? JSON.parse(o.payloadText) : null;
      const canonical = payload?.canonical ? JSON.parse(payload.canonical) : null;
      assetIds = Object.values(canonical?.files ?? {}).map((e: any) => e?.assetId).filter(Boolean);
    } catch { /* ignore */ }
    console.log(`  ${String(o.createdAt).slice(5, 19)}→${String(o.updatedAt).slice(11, 19)} ${o.purpose}/${o.status} ${name} op=${o.id}`);
    console.log(`    冻结载荷 assetId: ${assetIds.length ? assetIds.join(', ') : '(无 canonical)'}`);
  }

  // ③ 三家的提交结果
  const subs = await p.supplierBidSubmission.findMany({
    where: { supplierId: { in: sups.map(s => s.id) } },
    select: { supplierId: true, status: true, envelopeVersion: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 10,
  });
  console.log(`\n━━ SupplierBidSubmission ${subs.length} 条:`);
  for (const s of subs) console.log(`  ${byId.get(s.supplierId)!.name.slice(0, 5)} ${s.status} v=${s.envelopeVersion} @${s.createdAt.toISOString().slice(5, 19)}`);

  // ④ 弘沣近 4h 全部 POST 日志（确认他自己的 submit 结果）
  const hong = sups.find(s => s.name.includes('弘沣'))!;
  const posts = await p.$queryRawUnsafe(
    `SELECT method, path, "statusCode", "createdAt" FROM "OperationLog"
     WHERE "userId" = $1 AND method = 'POST' AND "createdAt" > $2::timestamp
     ORDER BY "createdAt" DESC LIMIT 20`,
    hong.userId, new Date(Date.now() - 4 * 3600e3).toISOString(),
  );
  console.log(`\n━━ 弘沣近4h POST ${posts.length} 条:`);
  for (const l of posts) console.log(`  ${String(l.createdAt).slice(11, 19)} ${l.statusCode} ${l.path}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
