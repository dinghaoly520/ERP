/**
 * SCCA 阶段1 Task12：隔离账号试点准备
 * 建隔离测试供应商：creditCode=测试盾 DN 的 18 位号、status=APPROVED、pilot 标记
 * 运行：cd apps/api && npx tsx scripts/scca-pilot-account.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 测试盾实测值（E1-R2b：DN 的 SN=/OU=NO.1: = 500999202610091118）
// 注意：这是占位值——正式部署须换真实 USCC；格式断言见下方
const PILOT_CREDIT_CODE = '500999202610091118';
const PILOT_NAME = 'SCCA试点供应商';

async function main() {
  // USCC 格式断言（18 位、首字符数字 1-9、第 2 位字母或数字混合——测试盾为纯数字占位）
  if (!/^[0-9A-Z]{18}$/.test(PILOT_CREDIT_CODE)) {
    throw new Error(`creditCode 格式不符：${PILOT_CREDIT_CODE}（须 18 位数字/大写字母）`);
  }
  console.log(`creditCode 格式校验通过：${PILOT_CREDIT_CODE}`);

  // 检查是否已存在（幂等）
  const existing = await prisma.supplier.findFirst({
    where: { creditCode: PILOT_CREDIT_CODE },
    include: { user: { select: { id: true, username: true, isActive: true } } },
  });

  if (existing) {
    console.log('试点供应商已存在：', JSON.stringify({
      id: existing.id, name: existing.name, status: existing.status,
      userId: existing.user?.id, username: existing.user?.username,
    }, null, 2));
    if (existing.status !== 'APPROVED') {
      await prisma.supplier.update({ where: { id: existing.id }, data: { status: 'APPROVED' } });
      console.log('已修正 status → APPROVED');
    }
    process.exit(0);
  }

  // 创建 User + Supplier
  const username = PILOT_CREDIT_CODE; // 供应商登录用户名 = 统一社会信用代码（CLAUDE.md 约定）
  const user = await prisma.user.upsert({
    where: { username_role: { username, role: 'supplier' } },
    create: {
      username,
      role: 'supplier',
      isActive: true,
      // 密码用 bcrypt hash 'SCCA-Pilot@2026'
      passwordHash: '$2b$10$H33RgQHcZ2tpFc1uSG1ZYuW.gQq4Bh/Py5A.q0GX.ef065bOewooK',
      displayName: PILOT_NAME,
    },
    update: { isActive: true, displayName: PILOT_NAME },
  });

  const supplier = await prisma.supplier.create({
    data: {
      userId: user.id,
      supplierNo: `SUP-PILOT-${Date.now().toString().slice(-6)}`,
      creditCode: PILOT_CREDIT_CODE,
      name: PILOT_NAME,
      normalizedName: PILOT_NAME,
      enterpriseType: 'OTHER',
      legalPerson: '试点',
      registeredAddress: '四川省成都市试点地址',
      businessScope: '试点用途',
      status: 'APPROVED',
    },
  });

  console.log('✅ 试点供应商已创建：', JSON.stringify({
    supplierId: supplier.id,
    userId: user.id,
    username: user.username,
    creditCode: supplier.creditCode,
    name: supplier.name,
    status: supplier.status,
  }, null, 2));
  console.log('\n密码登录账号：', username, '/ SCCA-Pilot@2026');
  console.log('加入试点白名单：在 .env 设 CA_PILOT_SUBJECT_IDS=' + supplier.id);
}

main().catch(console.error).finally(() => prisma.$disconnect());
