/**
 * 一次性补清洗（2026-10-14 驳回清洗上线后的存量兜底）：
 * 「驳回清洗」（reject() → purgeRejectedSupplier）只对功能上线后的驳回生效；
 * 上线前已被驳回（status='REJECTED'）的存量供应商行未清洗——业务字段/子表/User 敏感列/
 * 审批快照/附件仍残存旧数据，会让「壳重开」注册查重（legalPersonIdCardIdx / User.phoneIdx /
 * 联系人 idCardIdx）命中壳自身（register 已带 NOT 自排除兜底，本脚本彻底收敛残留）。
 *
 * 逻辑镜像 apps/api/src/supplier/supplier.service.ts 的 purgeRejectedSupplier（留壳口径一致）：
 *   ① 子表删空  ② Supplier 业务字段置空  ③ User 敏感列置 null  ④ 审批快照最小化  ⑤ 附件 DB+MinIO 删除
 * 留壳（name/creditCode/supplierNo/status=REJECTED/rejectReason/reviewStage）供审计与壳重开。
 * 幂等：对已清洗的壳再跑一遍为 no-op。
 *
 * 运行方式（在 apps/api 目录下）：
 *   npx tsx scripts/purge-existing-rejected-suppliers.ts            # dry-run（默认）：仅打印清洗清单，不落库
 *   npx tsx scripts/purge-existing-rejected-suppliers.ts --execute  # 实际执行落库（逐壳一个事务，单壳失败跳过不中断）
 */
import { PrismaClient } from '@prisma/client';
import { minioClient, MINIO_BUCKET } from '../src/upload/minio.client';

const prisma = new PrismaClient();
const execute = process.argv.includes('--execute');

type Shell = {
  id: string;
  userId: string;
  name: string;
  creditCode: string | null;
  supplierNo: string;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  legalPersonIdCardIdx: string | null;
  user: { id: string; displayName: string; phoneIdx: string | null; passwordHash: string | null } | null;
};

/** 残留检测 + 清洗内容摘要（dry-run 与 --execute 共用） */
async function collectResidue(shell: Shell) {
  const supplierId = shell.id;
  const [contacts, qualifications, bankAccounts, performances, classificationLinks, approvalRecords, assets] =
    await Promise.all([
      prisma.supplierContact.count({ where: { supplierId } }),
      prisma.supplierQualification.count({ where: { supplierId } }),
      prisma.supplierBankAccount.count({ where: { supplierId } }),
      prisma.supplierPerformance.count({ where: { supplierId } }),
      prisma.supplierClassificationLink.count({ where: { supplierId } }),
      prisma.supplierApprovalRecord.count({ where: { supplierId } }),
      prisma.fileAsset.count({
        where: { uploaderId: shell.userId, category: { in: ['qualification', 'general'] } },
      }),
    ]);
  const bizFieldsDirty = !!(shell.enterpriseType || shell.legalPerson || shell.registeredAddress || shell.businessScope || shell.legalPersonIdCardIdx);
  const userDirty = !!shell.user && !!(shell.user.displayName || shell.user.phoneIdx || shell.user.passwordHash);
  const residue =
    contacts + qualifications + bankAccounts + performances + classificationLinks + approvalRecords + assets > 0 ||
    bizFieldsDirty ||
    userDirty;
  const summary = [
    `联系人${contacts} 资质${qualifications} 银行${bankAccounts} 业绩${performances} 分类关联${classificationLinks} 审批留痕${approvalRecords}（快照最小化） 附件${assets}（DB+MinIO）`,
    `Supplier业务字段${bizFieldsDirty ? '置空' : '已空'}`,
    `User敏感列${userDirty ? '置null' : '已null'}`,
  ].join(' | ');
  return { residue, summary };
}

async function purgeOne(shell: Shell): Promise<void> {
  const supplierId = shell.id;
  await prisma.$transaction(async (tx) => {
    // ① 子表删空
    await tx.supplierContact.deleteMany({ where: { supplierId } });
    await tx.supplierQualification.deleteMany({ where: { supplierId } });
    await tx.supplierBankAccount.deleteMany({ where: { supplierId } });
    await tx.supplierPerformance.deleteMany({ where: { supplierId } });
    await tx.supplierClassificationLink.deleteMany({ where: { supplierId } });

    // ② Supplier 业务字段置空（NOT NULL 文本列置 ''；tags 置 []；urgedAt 置 null）
    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        enterpriseType: '', legalPerson: '', registeredAddress: '', businessScope: '',
        legalPersonIdCard: null, legalPersonPhone: null, legalPersonIdCardIdx: null,
        detailedAddress: null, logoUrl: null, organizationCode: null,
        country: null, region: null, registeredCapital: null, industry: null,
        companyEmail: null, companyWebsite: null, establishedDate: null,
        companyProfile: null, classificationId: null, urgedAt: null, tags: [],
      },
    });

    // ③ User 敏感列置 null（displayName 为 NOT NULL，置 ''；passwordHash=null 使登录天然拒绝）
    await tx.user.update({
      where: { id: shell.userId },
      data: {
        displayName: '', email: null, phone: null, phoneIdx: null,
        passwordHash: null, passwordVault: null,
      },
    });

    // ④ 审批快照最小化（全部 SupplierApprovalRecord）
    const records = await tx.supplierApprovalRecord.findMany({
      where: { supplierId },
      select: { id: true, action: true, stage: true, reason: true },
    });
    const purgedAt = new Date().toISOString();
    for (const r of records) {
      await tx.supplierApprovalRecord.update({
        where: { id: r.id },
        data: {
          snapshot: {
            purged: true, purgedAt,
            name: shell.name, creditCode: shell.creditCode, supplierNo: shell.supplierNo,
            action: r.action, stage: r.stage, reason: r.reason,
          },
        },
      });
    }
  });

  // ⑤ 附件：FileAsset 元数据（DB）+ MinIO 对象（best-effort，删除失败不阻断）
  const assets = await prisma.fileAsset.findMany({
    where: { uploaderId: shell.userId, category: { in: ['qualification', 'general'] } },
    select: { id: true, key: true, sealedPath: true },
  });
  for (const a of assets) {
    try { await minioClient.removeObject(MINIO_BUCKET, a.key); } catch { /* best-effort */ }
    if (a.sealedPath) { try { await minioClient.removeObject(MINIO_BUCKET, a.sealedPath); } catch { /* best-effort */ } }
  }
  if (assets.length) {
    await prisma.fileAsset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
  }
}

async function main() {
  const shells = await prisma.supplier.findMany({
    where: { status: 'REJECTED' },
    select: {
      id: true, userId: true, name: true, creditCode: true, supplierNo: true,
      enterpriseType: true, legalPerson: true, registeredAddress: true, businessScope: true,
      legalPersonIdCardIdx: true,
      user: { select: { id: true, displayName: true, phoneIdx: true, passwordHash: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`存量 REJECTED 壳共 ${shells.length} 家 | 模式：${execute ? 'EXECUTE（落库）' : 'DRY-RUN（仅打印清单）'}\n`);

  let cleaned = 0;
  let alreadyClean = 0;
  let failed = 0;
  for (const [i, shell] of shells.entries()) {
    const { residue, summary } = await collectResidue(shell);
    console.log(`[${i + 1}/${shells.length}] ${shell.name} | creditCode=${shell.creditCode ?? '-'} | ${shell.supplierNo}`);
    console.log(`      ${residue ? '清洗：' : '已清洗（no-op）：'}${summary}`);
    if (!residue) { alreadyClean++; console.log(''); continue; }
    if (!execute) { console.log(''); continue; }
    try {
      await purgeOne(shell);
      cleaned++;
    } catch (err) {
      failed++;
      console.error(`      ✗ 清洗失败（跳过继续）：${(err as Error).message}`);
    }
    console.log('');
  }

  console.log(
    execute
      ? `完成：清洗 ${cleaned} 家、已清洗跳过 ${alreadyClean} 家、失败 ${failed} 家（失败项见上方错误，可重跑收敛）`
      : `dry-run 结束：待清洗 ${shells.length - alreadyClean} 家、已清洗 ${alreadyClean} 家。确认无误后加 --execute 落库`,
  );
  if (!execute && shells.length - alreadyClean > 0) {
    console.log('提示：dry-run 不做任何写操作；--execute 后不可恢复（附件 DB+MinIO 删除、业务字段抹除），建议先备份。');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
