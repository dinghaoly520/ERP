/* eslint-disable */
/**
 * Import suppliers from scripts/suppliers_import.json into the ERP database.
 *
 * For each supplier:
 *  - upsert a User (role=supplier, username s<creditCode> or s<name-hash>, pwd Supplier@2026)
 *  - upsert a Supplier (by creditCode when present, else by normalizedName) — status APPROVED
 *  - replace contacts + qualifications
 *  - assign a business classification derived from 业务类型 / 推荐业务范围 keywords
 *
 * Idempotent: safe to re-run.
 *
 * Usage:  npx tsx scripts/import-suppliers.ts
 */
import { PrismaClient, type SupplierStatus } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

type ImportContact = { name: string; phone: string };
type ImportSupplier = {
  name: string;
  creditCode: string | null;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  businessType: string | null;
  qualificationText: string | null;
  contacts: ImportContact[];
  remark: string;
  riskHint: string | null;
  sources: string[];
};

// ── Classification taxonomy (code → name) ──
const CLASSIFICATIONS: { code: string; name: string; desc: string }[] = [
  { code: 'IT_INFO', name: '信息技术与软件', desc: '软件开发、信息化建设、信息技术服务、内控系统' },
  { code: 'SURVEY', name: '勘测设计与测绘', desc: '勘测、设计、测绘、水利模型试验、岩土工程' },
  { code: 'CONSTR', name: '工程施工与装修', desc: '建设工程施工、装饰装修、劳务外委' },
  { code: 'EQUIP', name: '设备与物资', desc: '电子设备、专业设备、家具、固定资产' },
  { code: 'TAX_AUDIT', name: '税务审计与评估', desc: '税务、审计、资产评估' },
  { code: 'FOOD', name: '餐饮食材与零售', desc: '餐饮、食材配送、茶叶酒水、综合零售' },
  { code: 'SERVICE', name: '综合服务', desc: '物业保洁、运输仓储、人力资源、保险、医疗' },
  { code: 'VEHICLE', name: '车辆服务', desc: '车辆综合服务、车辆评估、汽车维修' },
  { code: 'AD_OFFICE', name: '广告宣传与办公', desc: '广告宣传设计、办公耗材、印刷' },
  { code: 'OTHER', name: '其他', desc: '未归类供应商' },
];

// keyword → classification code, first match wins (order matters)
const CATEGORY_RULES: [RegExp, string][] = [
  [/软件|信息|信息化|内控|it/i, 'IT_INFO'],
  [/勘测|勘察|测绘|设计|模型试验|岩土|地质|水文|水利|水工/, 'SURVEY'],
  [/施工|装修|装饰|外委|建设工程|建筑/, 'CONSTR'],
  [/设备|固定资产|电子|专业设备|led|厨房|家具|平板/i, 'EQUIP'],
  [/税务|审计|资产评估|评估/, 'TAX_AUDIT'],
  [/餐饮|食材|茶叶|酒水|食品|零售/, 'FOOD'],
  [/物业|保洁|清洁|运输|仓储|人力资源|劳务|保险|医疗/, 'SERVICE'],
  [/车辆|汽车/, 'VEHICLE'],
  [/广告|宣传|办公|耗材|印刷/, 'AD_OFFICE'],
];

function classify(s: ImportSupplier): string {
  const text = `${s.businessType ?? ''} ${s.businessScope}`.toLowerCase();
  for (const [re, code] of CATEGORY_RULES) {
    if (re.test(text)) return code;
  }
  return 'OTHER';
}

function normalized(name: string): string {
  // match app rule: name.trim().toLowerCase()
  return name.trim().toLowerCase();
}

function makeUsername(s: ImportSupplier): string {
  if (s.creditCode) return 's' + s.creditCode;
  const h = createHash('md5').update(normalized(s.name)).digest('hex').slice(0, 12);
  return 's' + h;
}

async function main() {
  const data: ImportSupplier[] = JSON.parse(
    readFileSync(join(__dirname, 'suppliers_import.json'), 'utf-8'),
  );
  console.log(`Loaded ${data.length} suppliers from JSON`);

  // The source Excel has a few rows where two DIFFERENT companies share one
  // creditCode (a data-entry error). creditCode is @unique, so keep the code
  // on the first occurrence and null it for the duplicate (keyed by name instead).
  const seenCc = new Map<string, string>();
  let ccDupes = 0;
  for (const s of data) {
    if (s.creditCode) {
      if (seenCc.has(s.creditCode)) {
        ccDupes++;
        s.creditCode = null;
      } else {
        seenCc.set(s.creditCode, s.name);
      }
    }
  }
  if (ccDupes) console.log(`Resolved ${ccDupes} duplicate-creditCode conflict(s) (nulled the duplicate)`);

  // 1. ensure classifications
  const classMap = new Map<string, string>();
  for (const c of CLASSIFICATIONS) {
    const rec = await prisma.supplierClassification.upsert({
      where: { code: c.code },
      update: { name: c.name, description: c.desc },
      create: { code: c.code, name: c.name, description: c.desc },
    });
    classMap.set(c.code, rec.id);
  }
  console.log(`Ensured ${CLASSIFICATIONS.length} classifications`);

  const pwdHash = hashSync('Supplier@2026', 10);
  const status: SupplierStatus = 'APPROVED';
  let created = 0, skipped = 0;
  const stats = { users: 0, suppliers: 0, contacts: 0, quals: 0, withClass: 0 };
  const errs: string[] = [];

  for (const s of data) {
    const nname = normalized(s.name);
    if (!nname) { skipped++; continue; }
    const username = makeUsername(s);
    const classCode = classify(s);
    const classId = classMap.get(classCode)!;

    try {
      // 2. upsert user
      const displayName =
        s.contacts[0]?.name || s.legalPerson || s.name;
      const user = await prisma.user.upsert({
        where: { username },
        update: { displayName, role: 'supplier', isActive: true },
        create: {
          username,
          displayName,
          role: 'supplier',
          isActive: true,
          passwordHash: pwdHash,
        },
      });
      stats.users++;

      // 3. upsert supplier (by creditCode when present, else by normalizedName)
      const where = s.creditCode ? { creditCode: s.creditCode } : { normalizedName: nname };
      const supplier = await prisma.supplier.upsert({
        where: where as any,
        update: {
          name: s.name,
          normalizedName: nname,
          creditCode: s.creditCode,
          enterpriseType: s.enterpriseType,
          legalPerson: s.legalPerson,
          registeredAddress: s.registeredAddress,
          businessScope: s.businessScope,
          status,
          classificationId: classId,
        },
        create: {
          userId: user.id,
          name: s.name,
          normalizedName: nname,
          creditCode: s.creditCode,
          enterpriseType: s.enterpriseType,
          legalPerson: s.legalPerson,
          registeredAddress: s.registeredAddress,
          businessScope: s.businessScope,
          status,
          classificationId: classId,
        },
      });
      stats.suppliers++;
      if (classCode !== 'OTHER') stats.withClass++;
      created++;

      // 4. replace contacts
      await prisma.supplierContact.deleteMany({ where: { supplierId: supplier.id } });
      for (let i = 0; i < s.contacts.length; i++) {
        const c = s.contacts[i];
        if (!c.name && !c.phone) continue;
        await prisma.supplierContact.create({
          data: { supplierId: supplier.id, name: c.name || '—', phone: c.phone || '—', isPrimary: i === 0 },
        });
        stats.contacts++;
      }

      // 5. qualifications (资质/许可/认证 + 持证等级 stored as text record)
      await prisma.supplierQualification.deleteMany({ where: { supplierId: supplier.id } });
      if (s.qualificationText && s.qualificationText.trim()) {
        await prisma.supplierQualification.create({
          data: {
            supplierId: supplier.id,
            type: '资质证书',
            name: s.qualificationText.slice(0, 1000),
            fileUrl: '',
            status: '有效',
          },
        });
        stats.quals++;
      }
    } catch (e: any) {
      errs.push(`${s.name}: ${e.message}`);
    }
  }

  console.log('\n=== Import complete ===');
  console.log(`Suppliers created/updated: ${created}, skipped: ${skipped}`);
  console.log(`Users: ${stats.users}, Contacts: ${stats.contacts}, Qualifications: ${stats.quals}`);
  console.log(`Classified (non-OTHER): ${stats.withClass}/${created}`);
  if (errs.length) {
    console.log(`\nERRORS (${errs.length}):`);
    errs.slice(0, 20).forEach((e) => console.log('  - ' + e));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
