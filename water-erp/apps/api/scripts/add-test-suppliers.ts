/**
 * 一次性：直插三家测试供应商（用户裁定 2026-10-19，供 SCCA CA 绑定试点）。
 * 口径对齐 seed：用户名=公司名、口令统一 supplier@2026（bcrypt）、status=APPROVED、
 * 归属设计院本部（co-swhi-sjy）+ SupplierCompanyLink 同步；supplierNo 走 supplier_no_seq。
 * 幂等：同名 Supplier 已存在则跳过并复用其 id。跑完打印 Supplier.id 供 CA_PILOT_SUBJECT_IDS 追加。
 */
import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

const SJY_ID = 'co-swhi-sjy';
const PASSWORD = 'supplier@2026';
const COMPANIES = [
  { name: '测试机床有限公司', creditCode: '91510100MA6TEST01X' },
  { name: '测试环保技术装备有限公司', creditCode: '91510100MA6TEST02X' },
  { name: '测试发展有限公司', creditCode: '91510100MA6TEST03X' },
];

async function nextSupplierNo(): Promise<string> {
  const r = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('supplier_no_seq') AS n`;
  return `SUP-${String(r[0]!.n).padStart(6, '0')}`;
}

async function main() {
  const sjy = await prisma.company.findUnique({ where: { id: SJY_ID } });
  if (!sjy) throw new Error(`${SJY_ID} 公司主数据不存在，请先核对 companies 表`);

  const passwordHash = hashSync(PASSWORD, 10);
  const supplierIds: string[] = [];

  for (const { name, creditCode } of COMPANIES) {
    const existing = await prisma.supplier.findFirst({ where: { name }, select: { id: true, supplierNo: true } });
    if (existing) {
      console.log(`跳过（已存在）：${name} → ${existing.id}（${existing.supplierNo}）`);
      supplierIds.push(existing.id);
      continue;
    }

    const user = await prisma.user.create({
      data: { username: name, displayName: name, role: 'supplier', passwordHash },
      select: { id: true },
    });
    const supplier = await prisma.supplier.create({
      data: {
        userId: user.id,
        supplierNo: await nextSupplierNo(),
        name,
        normalizedName: name,
        creditCode,
        organizationCode: creditCode,
        enterpriseType: '有限责任公司',
        legalPerson: '测试法人',
        registeredAddress: '四川省成都市（测试数据）',
        businessScope: '测试用途（CA 绑定试点）',
        companyId: sjy.id,
        companyName: sjy.name,
        status: 'APPROVED',
      },
      select: { id: true, supplierNo: true },
    });
    await prisma.supplierCompanyLink.create({
      data: { supplierId: supplier.id, companyId: sjy.id, status: 'APPROVED', appliedAt: new Date() },
    });

    console.log(`新增：${name} → Supplier.id=${supplier.id}（${supplier.supplierNo}）User=${user.id}`);
    supplierIds.push(supplier.id);
  }

  console.log(`\nCA_PILOT_SUBJECT_IDS 追加段：${supplierIds.join(',')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
