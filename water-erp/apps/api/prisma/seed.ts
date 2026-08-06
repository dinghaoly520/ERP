/**
 * Seed —— 从 prisma/seed-data/*.json 重建数据库到一个固定快照状态。
 *
 * 工作方式
 *   1. 先 `TRUNCATE ... RESTART IDENTITY CASCADE` 清空全部业务表（与 _prisma_migrations 无关）；
 *   2. 再按外键依赖顺序 `createMany` 把 JSON 快照写回（空快照 `[]` 即空操作）。
 * 由此 seed 是幂等的：多次运行结果一致，始终复现同一份数据快照。
 *
 * 数据来源
 *   `npx tsx prisma/scripts/dump-seed.ts`  从真实库导出全部 28 张业务表为 seed-data/*.json。
 *   需要更新快照时：先改库，再重跑 dump-seed.ts，最后提交新的 JSON 文件即可。
 *
 * 账号说明
 *   seed 直接写回库中真实的 bcrypt 口令哈希；常用演示账号口令沿用 `<用户名>@2026`（见下方输出）。
 *   评审专家例外：seed 末尾会把用户名重置为专家姓名、口令统一为 `expert@2026`，便于演示登录。
 *
 * 注意
 *   `ProcurementProject.json` 为空——导出快照前该表数据已被一次失败的 seed 清空且未能恢复，
 *   故 BudgetList 的 procurementProjectId 一并被置空。如需采购立项演示数据，请重新创建后重跑 dump。
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { minioClient, MINIO_BUCKET } from '../src/upload/minio.client';
import { encryptBuffer } from '../src/announcement/bid-document.crypto';
import { wrapKey } from '../src/common/crypto/envelope-crypto';

const prisma = new PrismaClient();
const dataDir = join(__dirname, 'seed-data');

/** 读取一张表的 JSON 快照。 */
function load<T = Record<string, unknown>[]>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf-8')) as T;
}

// 所有业务表名（共 73 张，不含 Prisma 内部的 _prisma_migrations）。
const ALL_TABLES = [
  'Announcement', 'AnnouncementAttachment', 'AssistantActionLog',
  'Attachment', 'AuditLog',
  'BidArchiveItem', 'BidClarification', 'BidDocument', 'BidDocumentAccess',
  'BidEvaluationResult', 'BidExpert', 'BidOpeningRecord', 'BidOpeningSession',
  'BidProject', 'BidScoreItem', 'BidScorePoint', 'BidScoreRecord',
  'BidSupervisionAnnotation', 'BidSupervisionLog', 'BidSupplier',
  'BudgetItem', 'BudgetList',
  'CatalogCategory', 'CatalogInquiry', 'CatalogItemAttribute', 'CatalogItemRelation',
  'CatalogItem', 'CatalogSupplier', 'CatalogVersion', 'CategoryAttributeTemplate',
  'ComplianceRule', 'Contact', 'ContractPrice',
  'Department', 'DocumentChunk',
  'ExpertEvaluation', 'ExpertProfile', 'ExtractionTask',
  'FileAsset', 'ImportBatch',
  'KnowledgeBase', 'KnowledgeFile',
  'Notification', 'NotificationDeliveryLog',
  'PasswordChangeRequest', 'PasswordResetRequest',
  'PriceAlert', 'PriceAlertRule', 'PriceHistory',
  'ProcurementProject', 'ProcurementRound', 'Project',
  'ProjectManagementItem', 'ProjectManagementStage',
  'ReviewTask', 'RoundParticipant',
  'Supplier', 'SupplierBidSubmission', 'SupplierCatalogApplication',
  'SupplierChangeRecord', 'SupplierClassification', 'SupplierContact',
  'SupplierEvaluation', 'SupplierQualification',
  'SystemConfig',
  'TenderDocumentHistory', 'TenderFieldSample',
  'User', 'UserFavorite', 'UserSettings',
  'WorkArrangement', 'WorkArrangementDailyPlanCache',
  'WorkArrangementDependency', 'WorkArrangementNote', 'WorkArrangementTemplate',
  // @@map 表名（与模型名不同，TRUNCATE 需要实际 DB 表名）
  'ai_bid_analysis_tasks', 'ai_bid_reports',
  'ai_bidder_results', 'ai_concordance_results',
  'assistant_alerts', 'assistant_conversations', 'assistant_messages',
  'bid_requirement_reviews', 'bid_score_deltas',
  'ScoreTemplate',
  'OpeningHallMessage',
  'OpeningHallReadCursor',
] as const;

// 按外键依赖分层写入（父表在前）。空快照 createMany 等价于空操作。
const SEED_ORDER: ReadonlyArray<[tableName: string, delegate: keyof PrismaClient]> = [
  // Level 0 —— 无外键 / 独立表
  ['Department', 'department'],
  ['SupplierClassification', 'supplierClassification'],
  ['BidProject', 'bidProject'],
  ['Announcement', 'announcement'],
  ['CatalogCategory', 'catalogCategory'],
  ['CatalogItem', 'catalogItem'],
  ['ScoreTemplate', 'scoreTemplate'],
  ['SystemConfig', 'systemConfig'],
  // Level 1 —— 依赖 Level 0
  ['CategoryAttributeTemplate', 'categoryAttributeTemplate'],
  ['User', 'user'],
  ['ProcurementProject', 'procurementProject'],
  ['FileAsset', 'fileAsset'],
  ['ExpertProfile', 'expertProfile'],
  ['Notification', 'notification'],
  ['Supplier', 'supplier'],
  ['BidSupplier', 'bidSupplier'],
  ['BidExpert', 'bidExpert'],
  ['BidScoreItem', 'bidScoreItem'],
  ['BidScorePoint', 'bidScorePoint'],
  ['BidOpeningSession', 'bidOpeningSession'],
  ['BidArchiveItem', 'bidArchiveItem'],
  ['PriceHistory', 'priceHistory'],
  ['ImportBatch', 'importBatch'],
  ['PriceAlertRule', 'priceAlertRule'],
  ['Project', 'project'],
  ['ProjectManagementItem', 'projectManagementItem'],
  ['ProcurementRound', 'procurementRound'],
  ['KnowledgeBase', 'knowledgeBase'],
  ['Contact', 'contact'],
  ['BudgetList', 'budgetList'],
  // Level 2 —— 依赖 Level 1
  ['UserSettings', 'userSettings'],
  ['PasswordChangeRequest', 'passwordChangeRequest'],
  ['PasswordResetRequest', 'passwordResetRequest'],
  ['SupplierContact', 'supplierContact'],
  ['SupplierQualification', 'supplierQualification'],
  ['SupplierEvaluation', 'supplierEvaluation'],
  ['SupplierChangeRecord', 'supplierChangeRecord'],
  ['SupplierBidSubmission', 'supplierBidSubmission'],
  ['BidScoreRecord', 'bidScoreRecord'],
  ['BidScoreDelta', 'bidScoreDelta'],
  ['BidOpeningRecord', 'bidOpeningRecord'],
  ['OpeningHallMessage', 'openingHallMessage'],
  ['OpeningHallReadCursor', 'openingHallReadCursor'],
  ['BidClarification', 'bidClarification'],
  ['BidSupervisionLog', 'bidSupervisionLog'],
  ['BidSupervisionAnnotation', 'bidSupervisionAnnotation'],
  ['BidDocument', 'bidDocument'],
  ['BidDocumentAccess', 'bidDocumentAccess'],
  ['BidRequirementReview', 'bidRequirementReview'],
  ['BidEvaluationResult', 'bidEvaluationResult'],
  ['BudgetItem', 'budgetItem'],
  ['AnnouncementAttachment', 'announcementAttachment'],
  ['NotificationDeliveryLog', 'notificationDeliveryLog'],
  ['UserFavorite', 'userFavorite'],
  ['AuditLog', 'auditLog'],
  ['CatalogSupplier', 'catalogSupplier'],
  ['SupplierCatalogApplication', 'supplierCatalogApplication'],
  ['CatalogItemAttribute', 'catalogItemAttribute'],
  ['CatalogItemRelation', 'catalogItemRelation'],
  ['CatalogVersion', 'catalogVersion'],
  ['CatalogInquiry', 'catalogInquiry'],
  ['ContractPrice', 'contractPrice'],
  ['PriceAlert', 'priceAlert'],
  ['AssistantConversation', 'assistantConversation'],
  ['AssistantAlert', 'assistantAlert'],
  ['AssistantMessage', 'assistantMessage'],
  ['AssistantActionLog', 'assistantActionLog'],
  ['ExpertEvaluation', 'expertEvaluation'],
  ['RoundParticipant', 'roundParticipant'],
  ['ProjectManagementStage', 'projectManagementStage'],
  ['WorkArrangement', 'workArrangement'],
  ['WorkArrangementTemplate', 'workArrangementTemplate'],
  ['Attachment', 'attachment'],
  ['KnowledgeFile', 'knowledgeFile'],
  ['ComplianceRule', 'complianceRule'],
  ['ReviewTask', 'reviewTask'],
  ['TenderFieldSample', 'tenderFieldSample'],
  ['TenderDocumentHistory', 'tenderDocumentHistory'],
  ['ExtractionTask', 'extractionTask'],
  ['DocumentChunk', 'documentChunk'],
  ['AiBidAnalysisTask', 'aiBidAnalysisTask'],
  // Level 3 —— 依赖 Level 2
  ['WorkArrangementDailyPlanCache', 'workArrangementDailyPlanCache'],
  ['WorkArrangementDependency', 'workArrangementDependency'],
  ['WorkArrangementNote', 'workArrangementNote'],
  ['AiBidderResult', 'aiBidderResult'],
  ['AiBidReport', 'aiBidReport'],
  ['AiConcordanceResult', 'aiConcordanceResult'],
];

/**
 * 生成 hero 项目投标 PDF（reportlab）+ 上传 MinIO（sealedPath）+ 更新真实 sha256。
 * 让 fetchBidderPlaintext 能读到真实文件，端到端 AI 分析可重现。
 * 幂等：seed 重跑覆盖上传 + sha256。python3/reportlab 不可用时跳过（不阻塞 seed）。
 */
async function ensureBidFiles() {
  console.log('▶ 生成投标 PDF + 上传 MinIO + 真实 sha256（hero 项目投标文件）');
  const script = join(__dirname, 'scripts', 'gen-bid-pdf.py');
  try {
    execSync(`python3 ${script}`, { stdio: 'pipe' });
  } catch {
    console.warn('  ⚠ python3 gen-bid-pdf.py 失败（缺 reportlab？），跳过投标文件上传；fetchBidderPlaintext 将无文件可读');
    return;
  }
  const mapping = [
    { assetId: 'cmqhero-file-tech01', pdf: '/tmp/seed-pdf/submission-tech01.pdf' },
    { assetId: 'cmqhero-file-biz01', pdf: '/tmp/seed-pdf/submission-biz01.pdf' },
    { assetId: 'cmqhero-file-tech02', pdf: '/tmp/seed-pdf/submission-tech02.pdf' },
    { assetId: 'cmqhero-file-biz02', pdf: '/tmp/seed-pdf/submission-biz02.pdf' },
  ];
  let uploaded = 0;
  for (const m of mapping) {
    const asset = await prisma.fileAsset.findUnique({ where: { id: m.assetId } });
    if (!asset?.sealedPath) continue;
    const buf = readFileSync(m.pdf);
    await minioClient.putObject(MINIO_BUCKET, asset.sealedPath, buf, buf.length, {
      'Content-Type': 'application/pdf',
    });
    const sha = createHash('sha256').update(buf).digest('hex');
    await prisma.fileAsset.update({ where: { id: m.assetId }, data: { sha256: sha } });
    console.log(`    ${m.assetId} → ${asset.sealedPath} (${buf.length}B, sha256 updated)`);
    uploaded++;
  }
  console.log(`    投标文件就绪：${uploaded}/${mapping.length}`);
}

/**
 * 生成 cmqhero-bid-proj01 招标文件 PDF（reportlab，含★号实质性条款）→ AES-256-GCM 加密
 * → 上传 MinIO（复用 fileAsset.key）→ wrapKey 包裹 DEK 回填 BidDocument.decryptKey，
 * 让专家端「招标文件」预览端到端可解密（见 expert-tender-document-preview-design.md 验证前置）。
 * 幂等：seed 重跑覆盖上传 + 重新加密 + 回填。python3/reportlab 不可用时跳过（不阻塞 seed）。
 */
async function ensureTenderFiles() {
  console.log('▶ 生成招标文件 PDF + 加密 + 上传 MinIO + 回填 decryptKey（cmqhero-bid-proj01 招标文件）');
  const script = join(__dirname, 'scripts', 'gen-tender-pdf.py');
  try {
    execSync(`python3 ${script}`, { stdio: 'pipe' });
  } catch {
    console.warn('  ⚠ python3 gen-tender-pdf.py 失败（缺 reportlab？），跳过招标文件上传；专家端预览将无法解密');
    return;
  }
  const docId = 'cmqhero-bd01';
  const doc = await prisma.bidDocument.findUnique({ where: { id: docId }, include: { fileAsset: true } });
  if (!doc?.fileAsset) {
    console.warn(`  ⚠ 招标文件 ${docId} 或其 fileAsset 不存在，跳过`);
    return;
  }
  const plaintext = readFileSync('/tmp/seed-pdf/tender-hero.pdf');
  const { ciphertext, decryptKey } = encryptBuffer(plaintext);
  await minioClient.putObject(MINIO_BUCKET, doc.fileAsset.key, ciphertext, ciphertext.length, {
    'Content-Type': 'application/pdf',
  });
  const wrapped = wrapKey(decryptKey, process.env.KMS_SECRET!);
  await prisma.bidDocument.update({ where: { id: docId }, data: { decryptKey: wrapped } });
  const sha = createHash('sha256').update(plaintext).digest('hex');
  await prisma.fileAsset.update({ where: { id: doc.fileAsset.id }, data: { sha256: sha, size: plaintext.length } });
  console.log(`    ${docId} → ${doc.fileAsset.key}（明文 ${plaintext.length}B → 密文 ${ciphertext.length}B，decryptKey 已包裹回填）`);
}

async function main() {
  console.log('▶ 清空业务表（TRUNCATE … RESTART IDENTITY CASCADE）');
  const tableList = ALL_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);

  console.log('▶ 按外键依赖顺序写入快照');
  for (const [tableName, delegate] of SEED_ORDER) {
    // SELF-REF: CatalogCategory 根节点先写，子节点后写（避开自引用 FK 约束）
    if (tableName === 'CatalogCategory') {
      const rows = load(tableName) as Record<string, unknown>[];
      const roots = rows.filter((r: any) => r.parentId == null);
      const children = rows.filter((r: any) => r.parentId != null);
      if (roots.length > 0) { await (prisma[delegate] as any).createMany({ data: roots }); console.log(`    ${tableName} (roots): ${roots.length}`); }
      if (children.length > 0) { await (prisma[delegate] as any).createMany({ data: children }); console.log(`    ${tableName} (children): ${children.length}`); }
      continue;
    }
    const rows = load(tableName) as Record<string, unknown>[];
    if (rows.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma[delegate] as any).createMany({ data: rows });
    console.log(`    ${tableName}: ${rows.length}`);
  }

  // ═══ 评审专家凭据规整 ═══
  // 真实库导出的专家用户名是编号（如 a000912）、口令为真实库哈希（本地不知明文）。
  // 统一重置为：用户名 = 专家姓名（displayName），口令 = expert@2026，便于演示登录。
  // 幂等：每次 seed 后专家凭据恒为此状态，即便从真实库重新 dump 也能自动修复。
  console.log('▶ 规整评审专家凭据（用户名=姓名，口令 expert@2026）');
  const expertHash = hashSync('expert@2026', 10);
  const experts = await prisma.user.findMany({ where: { role: 'bid_expert' } });
  let renamed = 0;
  let passwordOnly = 0;
  let conflictSkipped = 0;
  for (const u of experts) {
    const targetUsername = (u.displayName ?? '').trim() || u.username;
    if (targetUsername === u.username) {
      await prisma.user.update({ where: { id: u.id }, data: { passwordHash: expertHash } });
      passwordOnly++;
      continue;
    }
    const occupied = await prisma.user.findFirst({ where: { username: targetUsername } });
    if (occupied && occupied.id !== u.id) {
      console.warn(`  ⚠ 「${targetUsername}」已被占用，专家 ${u.username} 保留原用户名，仅重置口令`);
      await prisma.user.update({ where: { id: u.id }, data: { passwordHash: expertHash } });
      conflictSkipped++;
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { username: targetUsername, passwordHash: expertHash },
    });
    renamed++;
  }
  console.log(`    专家 ${experts.length} 名：重命名 ${renamed}、仅改口令 ${passwordOnly}、冲突跳过 ${conflictSkipped}`);

  // ═══ 供应商凭据规整 ═══
  // 与专家规整同理：供应商用户名原始为统一社会信用代码/短码（如 s9151…、supplier1、huaxi），不便演示。
  // 统一重置为：用户名 = 关联 Supplier.name（公司名），口令 = supplier@2026。
  // 幂等：每次 seed 后供应商凭据恒为此状态，即便从真实库重新 dump 也能自动修复。
  console.log('▶ 规整供应商凭据（用户名=公司名，口令 supplier@2026）');
  const supplierHash = hashSync('supplier@2026', 10);
  const supplierNameByUserId = new Map(
    (await prisma.supplier.findMany({ select: { userId: true, name: true } })).map((s) => [s.userId, s.name]),
  );
  const supplierUsers = await prisma.user.findMany({ where: { role: 'supplier' } });
  let supRenamed = 0;
  let supPasswordOnly = 0;
  let supConflictSkipped = 0;
  let supNoCompany = 0;
  for (const u of supplierUsers) {
    const companyName = supplierNameByUserId.get(u.id);
    if (!companyName) {
      supNoCompany++;
      continue;
    }
    const targetUsername = companyName.trim();
    if (targetUsername === u.username) {
      await prisma.user.update({ where: { id: u.id }, data: { passwordHash: supplierHash } });
      supPasswordOnly++;
      continue;
    }
    const occupied = await prisma.user.findFirst({
      where: { username: targetUsername, role: 'supplier', NOT: { id: u.id } },
    });
    if (occupied) {
      console.warn(`  ⚠ 「${targetUsername}」已被占用，供应商 ${u.username} 保留原用户名，仅重置口令`);
      await prisma.user.update({ where: { id: u.id }, data: { passwordHash: supplierHash } });
      supConflictSkipped++;
      continue;
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { username: targetUsername, passwordHash: supplierHash },
    });
    supRenamed++;
  }
  console.log(`    供应商 ${supplierUsers.length} 名：重命名 ${supRenamed}、仅改口令 ${supPasswordOnly}、冲突跳过 ${supConflictSkipped}、无公司名跳过 ${supNoCompany}`);

  // ═══ 「陈源远」账号口令规整（冗余保护）═══
  // User.json 的 passwordHash 已修正为「陈源远@2026」的正确 bcrypt。
  // 此 override 保留作 belt-and-suspenders：防止有人误改 User.json hash 时 seed 仍能保证可登录。
  console.log('▶ 规整「陈源远」账号口令（陈源远@2026）');
  const staffHash = hashSync('陈源远@2026', 10);
  const staffUsers = await prisma.user.findMany({ where: { username: '陈源远' } });
  for (const u of staffUsers) {
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: staffHash } });
  }
  console.log(`    陈源远 ${staffUsers.length} 个账号口令已重置`);

  // ═══ 内部管理账号口令规整（与 ACCOUNTS.md「<用户名>@2026」约定一致，使 :3005 有可登录的 leader/staff）═══
  console.log('▶ 规整内部管理账号口令（Swhi-CGZX-01 leader / Swhi-CGZX-05 staff / Swhi-CGZX-admin admin）');
  // admin 亦在列：tender-review 规则管理（AdminGuard）需 admin 角色，而 User.json 里的历史哈希明文不可考，
  // 不规整则 :3005 无任何可登录的 admin → 规则提取/CRUD 对所有人 403。
  for (const uname of ['Swhi-CGZX-01', 'Swhi-CGZX-05', 'Swhi-CGZX-admin']) {
    await prisma.user.updateMany({
      where: { username: uname },
      data: { passwordHash: hashSync(`${uname}@2026`, 10) },
    });
  }

  // ═══ 新增「开标主持人」bid_host 账号（演示 :3007 硬分流，与陈源远形成两个可指派对象）═══
  console.log('▶ 创建「开标主持人」bid_host 账号（口令 开标主持人@2026）');
  const hostAssgnHash = hashSync('开标主持人@2026', 10);
  await prisma.user.upsert({
    where: { username_role: { username: '开标主持人', role: 'bid_host' } },
    update: { passwordHash: hostAssgnHash, isActive: true, displayName: '开标主持人' },
    create: {
      username: '开标主持人',
      displayName: '开标主持人',
      role: 'bid_host',
      isActive: true,
      passwordHash: hostAssgnHash,
    },
  });

  // ═══ R6: 回填现有 BidProject 指派给「陈源远」bid_host（避免 :3007 硬分流后种子项目不可见）═══
  console.log('▶ 回填 BidProject 主持人指派（→ 陈源远 bid_host）');
  const chenBidHost = await prisma.user.findFirst({
    where: { username: '陈源远', role: 'bid_host' },
  });
  if (chenBidHost) {
    const result = await prisma.bidProject.updateMany({
      where: { assignedHostUserId: null },
      data: { assignedHostUserId: chenBidHost.id, assignedAt: new Date() },
    });
    console.log(`    回填 ${result.count} 个项目 → 陈源远`);
  } else {
    console.warn('    ⚠ 未找到 陈源远 bid_host，跳过回填');
  }

  // ═══ 投标文件持久化（让端到端 AI 分析可重现）═══
  await ensureBidFiles();

  // ═══ 招标文件持久化（让专家端「招标文件」预览端到端可解密）═══
  await ensureTenderFiles();

  const counts = {
    用户: await prisma.user.count(),
    供应商: await prisma.supplier.count(),
    供应商联系人: await prisma.supplierContact.count(),
    供应商资质: await prisma.supplierQualification.count(),
    供应商分类: await prisma.supplierClassification.count(),
    采购目录: await prisma.catalogItem.count(),
    公告: await prisma.announcement.count(),
    招标项目: await prisma.bidProject.count(),
    通知: await prisma.notification.count(),
    专家档案: await prisma.expertProfile.count(),
    预算清单: await prisma.budgetList.count(),
  };
  console.log('\n✔ Seed 完成，关键表行数：');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v}`);

  console.log('\n  各门户独立账号（每端口需单独登录，口令沿用 <用户名>@2026）：');
  console.log('    [信息门户   :3002]  公开访问，无需登录');
  console.log('    [电子商城   :3003]  陈源远 / 陈源远@2026');
  console.log('    [供应商端   :3004]  公司名登录 / 口令 supplier@2026（例：四川水发建设有限公司 / supplier@2026）');
  console.log('    [采购管理端 :3005]  陈源远 / 陈源远@2026');
  console.log('    [专家评标   :3006]  专家库任意专家（用户名=专家姓名）/ 口令 expert@2026');
  console.log('    [开评标管理端 :3007]  陈源远 / 陈源远@2026');
  console.log('    [开评标管理端 :3007]  开标主持人 / 开标主持人@2026（演示硬分流）');
}

main()
  .catch((e) => {
    console.error('Seed 失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
