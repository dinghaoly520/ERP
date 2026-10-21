/**
 * 一次性：把 2026-10-19 恢复的大岷管业数据固化进 seed 快照（用户裁定）。
 * - 追加进现有 JSON：User/Supplier/SupplierContact/SupplierQualification/FileAsset/
 *   ProjectManagementItem/ProjectManagementStage/BidProject/BidScoreItem/BidSupervisionLog/
 *   Announcement/BidDocument/Attachment
 * - 新建 JSON：SupplierApprovalRecord、SupplierBankAccount（配合 seed.ts SEED_ORDER 新增两行）
 * - 口径：快照 PII 须为明文合成（seed 的 PII_SEAL_MAP 会再密封）——现库密文值一律弃用：
 *   User.email/phone→null；Supplier.legalPersonPhone/legalPersonIdCard→null；
 *   SupplierContact.phone→合成 137 段（查重避让）、idCard/email→null。
 *   DMGY/wangziyang 口令标准化为 <用户名>@2026（原口令不可知，与 seed 惯例一致）。
 * - 不固化：Notification(107)、AiBidAnalysisTask(1)、announcement_histories(11，无 FK 不被 CASCADE 清)。
 * 幂等：快照中已有同 id 的条目跳过。
 */
const { PrismaClient } = require('@prisma/client');
const { hashSync } = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'prisma', 'seed-data');
const prisma = new PrismaClient();

const SUP_IDS = ['cmv0obbb000o8uuq254hjkkcw', 'cmv0oqdmm00rjuuq2kolq2r2a', 'cmv0oz3p000u0uuq2ff7aaopj'];
const USER_IDS = ['cmv0obbaw00o6uuq2hfg7dpzx', 'cmv0oqdmk00rhuuq21ufixco3', 'cmv0oz3ox00tyuuq2xya5f7ad', 'cmv0p1w0s011suuq27b27zvsx', 'cmumahxf205truuz5ud0v9gd3'];
const PMI_ID = 'cmv0purw601xuuuq2kynhqtpa';
const PROJ_ID = 'cmv0qrxbt001wuuwjsoitbcrj';
const ANN_IDS = ['cmv4rnq5401r2uueldh35tpal', 'cmv4ykwhj0032uuciage0xleh', 'cmv98h5sv00i4uuhyvov80k9x', 'cmv991b8k0022uuq2f86mg6u5'];
const FILE_IDS = ['cmv0o85w100nfuuq2i0etfex9', 'cmv0oatxo00nxuuq2k6puxdmh', 'cmv0o7og400nbuuq2lmtt6gex', 'cmv0ofm6l00pkuuq2hiy93b53', 'cmv0ovp3u00t7uuq20i9i6qce', 'cmv0oyzik00tvuuq2yxhb7uwd', 'cmv4rnqhv01r4uuel5h3fe7m6', 'cmv4ykwuc0034uuci3ued6rky', 'cmv98h65000i6uuhykfn30gqy', 'cmv991bl10024uuq295by3qgg'];

const loadJson = (f) => (fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : []);
const saveJson = (f, rows) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(rows, null, 2) + '\n');

/** 快照现有字段并集裁剪 + 去重（同 id 已存在则跳过） */
function mergeInto(file, newRows, mutate) {
  const existing = loadJson(file);
  const keys = new Set();
  for (const r of existing) Object.keys(r).forEach((k) => keys.add(k));
  let added = 0, skipped = 0;
  for (const row of newRows) {
    if (existing.some((e) => e.id === row.id)) { skipped++; continue; }
    const clean = {};
    for (const k of keys) if (row[k] !== undefined && row[k] !== null) clean[k] = row[k];
    if (mutate) mutate(clean);
    existing.push(clean);
    added++;
  }
  saveJson(file, existing);
  console.log(`${file.padEnd(30)} +${added} 条（跳过 ${skipped}）`);
}

function freshJson(file, rows, fields) {
  const out = rows.map((r) => {
    const clean = {};
    for (const k of fields) if (r[k] !== undefined && r[k] !== null) clean[k] = r[k];
    return clean;
  });
  saveJson(file, out);
  console.log(`${file.padEnd(30)} 新建 ${out.length} 条`);
}

async function main() {
  // ── 合成手机号（与现有快照查重避让）──
  const usedPhones = new Set(loadJson('SupplierContact.json').map((c) => c.phone).filter(Boolean));
  const synth = [];
  for (let n = 247; synth.length < 3; n++) {
    const p = `13700000${String(n).padStart(3, '0')}`;
    if (!usedPhones.has(p)) synth.push(p);
  }

  const users = await prisma.user.findMany({ where: { id: { in: USER_IDS } } });
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: SUP_IDS } } });
  const contacts = await prisma.supplierContact.findMany({ where: { supplierId: { in: SUP_IDS } } });
  const quals = await prisma.supplierQualification.findMany({ where: { supplierId: { in: SUP_IDS } } });
  const files = await prisma.fileAsset.findMany({ where: { id: { in: FILE_IDS } } });
  const pmi = await prisma.projectManagementItem.findMany({ where: { id: PMI_ID } });
  const stages = await prisma.projectManagementStage.findMany({ where: { projectManagementItemId: PMI_ID } });
  const bp = await prisma.bidProject.findMany({ where: { id: PROJ_ID } });
  const scoreItems = await prisma.bidScoreItem.findMany({ where: { projectId: PROJ_ID } });
  const supLogs = await prisma.bidSupervisionLog.findMany({ where: { projectId: PROJ_ID } });
  const anns = await prisma.announcement.findMany({ where: { id: { in: ANN_IDS } } });
  const docs = await prisma.bidDocument.findMany({ where: { announcementId: { in: ANN_IDS } } });
  const attachments = await prisma.attachment.findMany({ where: { projectManagementItemId: PMI_ID } });
  const approvals = await prisma.supplierApprovalRecord.findMany({ where: { supplierId: { in: SUP_IDS } } });
  const banks = await prisma.supplierBankAccount.findMany({ where: { supplierId: { in: SUP_IDS } } });

  const stdHash = (u) => hashSync(`${u}@2026`, 10);

  mergeInto('User.json', users, (r) => {
    r.email = null; r.phone = null; // 现库为密文，快照口径=明文合成；置空最稳
    if (r.username === 'DMGY' || r.username === 'wangziyang') r.passwordHash = stdHash(r.username);
    else r.passwordHash = hashSync('supplier@2026', 10); // 供应商：seed 规整段会再重置，直接标准值
  });
  mergeInto('Supplier.json', suppliers, (r) => {
    r.legalPersonPhone = null; r.legalPersonIdCard = null; // 密文→置空
  });
  // 联系人合成号按 supplierId 固定映射（避免顺序歧义）
  const phoneBySup = {};
  SUP_IDS.forEach((s, i) => (phoneBySup[s] = synth[i]));
  mergeInto('SupplierContact.json', contacts, (r) => {
    r.phone = phoneBySup[r.supplierId];
    r.idCard = null; r.email = null;
  });
  mergeInto('SupplierQualification.json', quals);
  mergeInto('FileAsset.json', files);
  mergeInto('ProjectManagementItem.json', pmi);
  mergeInto('ProjectManagementStage.json', stages);
  mergeInto('BidProject.json', bp);
  mergeInto('BidScoreItem.json', scoreItems);
  mergeInto('BidSupervisionLog.json', supLogs);
  mergeInto('Announcement.json', anns);
  mergeInto('BidDocument.json', docs);
  mergeInto('Attachment.json', attachments);

  const fields = (d) => Object.keys(d.fields);
  freshJson('SupplierApprovalRecord.json', approvals, fields(prisma.supplierApprovalRecord));
  freshJson('SupplierBankAccount.json', banks, fields(prisma.supplierBankAccount));

  console.log('\n合成手机号分配：', JSON.stringify(phoneBySup, null, 2));
  console.log('DMGY/wangziyang 口令已标准化为 <用户名>@2026；供应商账号 seed 后=公司名/supplier@2026');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
