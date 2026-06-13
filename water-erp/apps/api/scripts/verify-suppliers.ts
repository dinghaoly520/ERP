/* eslint-disable */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const sc = await p.supplier.count();
  const uc = await p.user.count({ where: { role: 'supplier' } });
  const byStatus = await p.supplier.groupBy({ by: ['status'], _count: true });
  const withCC = await p.supplier.count({ where: { creditCode: { not: null } } });
  const noCC = await p.supplier.count({ where: { creditCode: null } });
  const cls = await p.supplier.groupBy({ by: ['classificationId'], _count: true });
  const classRecs = await p.supplierClassification.findMany();
  const cmap = new Map(classRecs.map((c) => [c.id, c.name]));

  console.log('Total suppliers:', sc, '| supplier-role users:', uc);
  console.log('By status:', byStatus.map((s) => `${s.status}=${s._count}`).join(', '));
  console.log('creditCode: with=', withCC, ' null=', noCC);
  console.log('By classification:');
  for (const c of cls) console.log('   ', cmap.get(c.classificationId) || '(null)', ':', c._count);

  const cc = await p.supplierContact.count();
  const qc = await p.supplierQualification.count();
  console.log('Total contacts:', cc, '| qualifications:', qc);

  const zong = await p.supplier.findFirst({
    where: { creditCode: { not: null } },
    include: { contacts: true, qualifications: true, classification: true },
  });
  const sheng = await p.supplier.findFirst({
    where: { creditCode: null },
    include: { contacts: true, qualifications: true, classification: true },
  });
  console.log('\nSAMPLE 总表:', JSON.stringify({
    name: zong?.name, creditCode: zong?.creditCode, legalPerson: zong?.legalPerson,
    enterpriseType: zong?.enterpriseType, classification: zong?.classification?.name,
    contacts: zong?.contacts.length, quals: zong?.qualifications.length,
  }, null, 0));
  console.log('SAMPLE 生技部-only:', JSON.stringify({
    name: sheng?.name, creditCode: sheng?.creditCode, legalPerson: sheng?.legalPerson,
    classification: sheng?.classification?.name,
    businessScope: (sheng?.businessScope || '').slice(0, 50),
    quals: sheng?.qualifications.length,
  }, null, 0));
})().finally(() => p.$disconnect());
