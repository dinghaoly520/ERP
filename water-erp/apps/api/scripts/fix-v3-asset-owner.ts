/** 修复：v3 暂存密文归属回正——信封引用的 assetId 按 CaOperation 主体改回各自供应商的 userId */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const OPS: Array<[string, string]> = [
  // [operationId, 期望供应商名]
  ['cmvgaxrq8022ruub00zm3xyqn', '自贡市烨友腾隽汽车销售有限公司'], // 自贡最新
  ['cmvgavbj201ymuub05vdzmq63', '成都世纪远景汽车贸易有限公司'], // 远景最新
];

async function main() {
  for (const [opId, supName] of OPS) {
    const op = await p.caOperation.findUnique({ where: { id: opId } });
    if (!op) throw new Error(`op 不存在: ${opId}`);
    const payload = op.result as { canonical?: string } | null;
    if (!payload?.canonical) {
      console.log(`⚠ op ${opId} 无 canonical（result 原文前 200 字: ${JSON.stringify(op.result)?.slice(0, 200)}）——跳过`);
      continue;
    }
    const envelope = JSON.parse(payload.canonical) as { files?: Record<string, { assetId?: string }> };
    const entries = Object.entries(envelope.files ?? {});
    const supplier = await p.supplier.findFirst({ where: { name: supName }, select: { id: true, userId: true, name: true } });
    console.log(`\n━━ ${supName} op=${opId} 状态=${op.status}`);
    for (const [role, e] of entries) {
      const asset = e.assetId ? await p.fileAsset.findUnique({ where: { id: e.assetId }, select: { id: true, uploaderId: true, originalName: true } }) : null;
      if (!asset) { console.log(`  ${role}: assetId=${e.assetId} → ⚠ FileAsset 不存在`); continue; }
      if (asset.uploaderId === supplier!.userId) { console.log(`  ${role}: ${asset.id} 归属已正确，跳过`); continue; }
      const before = asset.uploaderId;
      await p.fileAsset.update({ where: { id: asset.id }, data: { uploaderId: supplier!.userId } });
      console.log(`  ${role}: ${asset.id} "${asset.originalName}" uploaderId …${before.slice(-6)} → …${supplier!.userId.slice(-6)} ✓`);
    }
  }
  console.log('\n━━ 终态核验（最新两 op 引用资产的归属）');
  for (const [opId, supName] of OPS) {
    const op = await p.caOperation.findUnique({ where: { id: opId } });
    const payload = op?.result as { canonical?: string } | null;
    if (!payload?.canonical) continue;
    const env = JSON.parse(payload.canonical) as { files?: Record<string, { assetId?: string }> };
    const supplier = await p.supplier.findFirst({ where: { name: supName }, select: { userId: true } });
    for (const [role, e] of Object.entries(env.files ?? {})) {
      const a = e.assetId ? await p.fileAsset.findUnique({ where: { id: e.assetId }, select: { uploaderId: true } }) : null;
      console.log(`  ${supName.slice(0, 5)} ${role}: owner=…${a?.uploaderId?.slice(-6)} 期望=…${supplier!.userId.slice(-6)} ${a?.uploaderId === supplier!.userId ? '✓' : '✗'}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
