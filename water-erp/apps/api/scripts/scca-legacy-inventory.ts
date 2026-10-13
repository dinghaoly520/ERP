/**
 * SCCA 阶段1 Task1 盘点脚本（附录 §6.3 第1步）
 * 输出：重复 ACTIVE / 跨主体同 certSn / certSource 分布 / 三套编号撞号预检 / 待签业务计数
 * 运行：cd apps/api && npx tsx scripts/scca-legacy-inventory.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const out: Record<string, unknown> = { ts: new Date().toISOString() };

  // 1) 同主体多 ACTIVE（部分唯一索引已阻止——盘点存量违规）
  const dupActive = await prisma.$queryRaw<Array<{ supplierId: string; cnt: bigint }>>`
    SELECT "supplierId", COUNT(*) as cnt FROM "SupplierCert"
    WHERE "bindingStatus" = 'ACTIVE' GROUP BY "supplierId" HAVING COUNT(*) > 1`;
  out.supplierMultiActive = dupActive;

  const dupActiveExpert = await prisma.$queryRaw<Array<{ userId: string; cnt: bigint }>>`
    SELECT "userId", COUNT(*) as cnt FROM "ExpertCert"
    WHERE "bindingStatus" = 'ACTIVE' GROUP BY "userId" HAVING COUNT(*) > 1`;
  out.expertMultiActive = dupActiveExpert;

  // 2) 跨主体同 certSn
  const dupCertSn = await prisma.$queryRaw<Array<{ certSn: string; cnt: bigint }>>`
    SELECT "certSn", COUNT(*) as cnt FROM "SupplierCert" GROUP BY "certSn" HAVING COUNT(*) > 1`;
  out.supplierDupCertSn = dupCertSn;

  const dupCertSnExpert = await prisma.$queryRaw<Array<{ certSn: string; cnt: bigint }>>`
    SELECT "certSn", COUNT(*) as cnt FROM "ExpertCert" GROUP BY "certSn" HAVING COUNT(*) > 1`;
  out.expertDupCertSn = dupCertSnExpert;

  // 3) certSource 分布
  const sourceDist = await prisma.supplierCert.groupBy({
    by: ['certSource'], _count: { _all: true },
  });
  out.supplierCertSourceDist = sourceDist;

  // 4) credentialScheme 分布（新列回填后）
  const schemeDist = await prisma.supplierCert.groupBy({
    by: ['credentialScheme'], _count: { _all: true },
  });
  out.supplierCertSchemeDist = schemeDist;

  // 5) 三套编号撞号预检（certSn 与 X.509 serial 格式冲突）
  // 厂商 certSN = 18 位数字（如 500999202610091118）；X.509 serial = hex（40 字符）
  const numericCertSn = await prisma.$queryRaw<Array<{cnt: bigint}>>`
    SELECT COUNT(*) as cnt FROM "SupplierCert" WHERE "certSn" ~ '^[0-9]{18}$'`;
  out.certSnLooksLikeVendorCertSN = Number(numericCertSn[0]?.cnt ?? 0);

  // 6) 待签业务计数（在途门禁的现有量）
  const pendingReceipts = await prisma.$queryRaw<Array<{cnt: bigint}>>`
    SELECT COUNT(*) as cnt FROM "SupplierBidSubmission"
    WHERE "receiptSignature" IS NULL AND "status" = 'submitted'`;
  out.pendingReceiptSignatures = Number(pendingReceipts[0]?.cnt ?? 0);

  // 7) CaCertificate 表行数（增量迁移后应=0）
  const caCertCount = await prisma.caCertificate.count();
  out.caCertificateCount = caCertCount;

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
