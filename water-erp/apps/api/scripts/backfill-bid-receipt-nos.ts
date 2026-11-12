/**
 * 一次性回填（2026-11-12 bug#101）：存量「已投递但 receiptNo=null」的 BidSupplier 行补 TB- 回执号。
 * 根因：回执号只在投递事务 create 分支生成；名册行先于投递存在（invite/rsvp 等建行不写号）时
 * 投递走 update 分支永不补号 → 主持人端回执编号列恒「—」、开标文件包带 null。
 * 服务端 update 分支已补齐（nextBidReceiptNo），本脚本清历史残留。
 *
 * 判定（收敛在投递事实，不做读时惰性补）：BidSupplier 行存在对应 status='submitted' 的
 * SupplierBidSubmission 且 receiptNo IS NULL → 按 submittedAt 日期生成 TB-yyyymmdd-NNN（撞号查重）。
 *
 * 签名安全（复核结论）：v3 回执签名归档的是签时全量快照（payload+签名+证书），复验不重读库——
 * 补号不破坏历史签名证据链。
 *
 * 用法：npx tsx scripts/backfill-bid-receipt-nos.ts           # dry-run（默认）
 *       npx tsx scripts/backfill-bid-receipt-nos.ts --execute
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

async function main() {
  // BidSupplier 与 SupplierBidSubmission 无 Prisma 关系（supplierId+projectId 复合逻辑关联）——分开查
  const rows = await prisma.bidSupplier.findMany({
    where: { receiptNo: null },
    select: { id: true, projectId: true, supplierId: true, supplierName: true },
  });
  const delivered: Array<{ id: string; supplierName: string; submittedAt: Date }> = [];
  for (const r of rows) {
    if (!r.supplierId) continue;
    const sub = await prisma.supplierBidSubmission.findFirst({
      where: { supplierId: r.supplierId, projectId: r.projectId, status: 'submitted' },
      select: { submittedAt: true },
    });
    if (sub) delivered.push({ id: r.id, supplierName: r.supplierName, submittedAt: sub.submittedAt });
  }
  if (!delivered.length) {
    console.log('未发现「已投递但无回执号」的行，无需回填。');
    return;
  }

  const plans: Array<{ id: string; supplierName: string; date: string; receiptNo: string }> = [];
  for (const r of delivered) {
    const date = r.submittedAt.toISOString().slice(0, 10).replace(/-/g, '');
    let receiptNo = '';
    for (let i = 0; i < 5; i++) {
      const cand = `TB-${date}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
      const clash = await prisma.bidSupplier.findFirst({ where: { receiptNo: cand }, select: { id: true } });
      if (!clash && !plans.some(p => p.receiptNo === cand)) { receiptNo = cand; break; }
    }
    if (!receiptNo) throw new Error(`撞号查重 5 次未收敛：${r.id}`);
    plans.push({ id: r.id, supplierName: r.supplierName, date, receiptNo });
  }

  console.log(`${execute ? '【执行】' : '【dry-run】'}${plans.length} 条待回填：\n`);
  for (const p of plans) console.log(`  ${p.id} ${p.supplierName}（投递日 ${p.date}）→ ${p.receiptNo}`);
  if (!execute) {
    console.log('\ndry-run 结束（未改动任何数据）。加 --execute 执行回填。');
    return;
  }
  for (const p of plans) {
    await prisma.bidSupplier.update({ where: { id: p.id }, data: { receiptNo: p.receiptNo } });
  }
  console.log(`\n已回填 ${plans.length} 条 BidSupplier.receiptNo。`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
