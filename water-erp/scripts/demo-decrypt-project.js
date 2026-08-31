#!/usr/bin/env node
/**
 * 解密演示项目脚本 —— 「竞价采购公告 — 引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（解密演示）」
 *
 * 用途：随时重建/重置一个停在「已确定开标（OPENING）、待组建开标会话」的演示项目，
 *       用于演示 :3007 组建会话 → 解密 → 唱标 → 供应商确认/异议/会场交流 全流程。
 *
 * 用法（在 water-erp/apps/api 目录下）：
 *   node ../../scripts/demo-decrypt-project.js create   # 新建（若已存在则先整体重建）
 *   node ../../scripts/demo-decrypt-project.js reset    # 一键回到「待组建会话」（清会话/解密/唱标/确认/交流；时间口径默认刷新为 now）
 *
 * 说明：
 *   - 复制自 BID-1786934256839（JJ-2026081702），复用 MinIO 上的加密标书与加密招标文件对象
 *     （KMS 信封密钥与项目无关，副本解密可用）。
 *   - 专家为另外抽取的 5 名（与原项目 5 人不同），全部已确认参加。
 *   - 时间口径：开标时间 = 执行时刻（now），投标截止 = 开标前 24 小时
 *     （BID_DEADLINE_BEFORE_OPENING_MS 口径，见 packages/shared/src/constants.ts），
 *     解密窗口 now ~ now+30min。
 */
const fs = require('fs');
const path = require('path');

// ── 0. 载入 apps/api/.env（Prisma 需要 DATABASE_URL） ──
const envPath = path.join(__dirname, '..', 'apps', 'api', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

// 依赖解析指向 apps/api（cuid2 / @prisma/client 装在 workspace 包内）
const { createRequire } = require('module');
const apiRequire = createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));
const { createId } = apiRequire('@paralleldrive/cuid2');
const { PrismaClient } = apiRequire('@prisma/client');
const prisma = new PrismaClient();

const MODE = process.argv[2] || 'create';
const SOURCE_CODE = 'BID-1786934256839';
const DEMO_CODE_PREFIX = 'BID-DEMO-';
const DEMO_NAME = '竞价采购公告 — 引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（解密演示）';

// 另外抽取的 5 名专家（避开原项目 5 人；专业配额：造价1/设备1/综合-地质1/地质2，组长=仇海亮）
const NEW_EXPERTS = [
  { userId: 'cf3c3f729cab20fd02db3f2', name: '代思敏', major: '造价' },
  { userId: 'cb75a8d6afbff9233f4eaa4', name: '刘黎波', major: '设备' },
  { userId: 'c33b380f7fa268d8d2da4bd', name: '李叶', major: '综合-地质' },
  { userId: 'c6401d5d1c4480790d0b0a7', name: '仇海亮', major: '地质', isLead: true },
  { userId: 'cca119a2d240fe6bc879622', name: '任国峰', major: '地质' },
];

const now = () => new Date();

/** 按 projectId 级联清理（新演示项目重建前 / reset 用；顺序：子表 → 主表） */
async function wipeProject(projectId, { keepProject = false } = {}) {
  await prisma.$executeRawUnsafe('DELETE FROM "OpeningHallReadCursor" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "OpeningHallMessage" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidOpeningSession" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidOpeningRecord" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "SupplierBidSubmission" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidSupplier" WHERE "projectId"=$1', projectId);
  await prisma.$executeRawUnsafe('DELETE FROM "BidExpert" WHERE "projectId"=$1', projectId);
  const items = await prisma.bidScoreItem.findMany({ where: { projectId }, select: { id: true } });
  for (const it of items) {
    await prisma.$executeRawUnsafe('DELETE FROM "BidScorePoint" WHERE "scoreItemId"=$1', it.id);
  }
  await prisma.$executeRawUnsafe('DELETE FROM "BidScoreItem" WHERE "projectId"=$1', projectId);
  for (const t of ['BidClarification', 'BidVote', 'BidEvaluationResult', 'BidArchiveItem', 'BidSupplierNudge', 'BidMotion', 'BidSignPacket', 'BidFileBackup', 'BidSupervisionLog']) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "projectId"=$1`, projectId).catch(() => {});
  }
  await prisma.$executeRawUnsafe('DELETE FROM ai_bidder_results WHERE "bidProjectId"=$1', projectId).catch(() => {});
  await prisma.$executeRawUnsafe('DELETE FROM ai_bid_analysis_tasks WHERE "projectId"=$1', projectId).catch(() => {});
  // 公告 + 招标文件 + PMI 宿主（仅重建时）
  if (!keepProject) {
    const ann = await prisma.announcement.findFirst({ where: { relatedProjectCode: (await prisma.bidProject.findUnique({ where: { id: projectId }, select: { projectCode: true } }))?.projectCode } });
    if (ann) {
      await prisma.$executeRawUnsafe('DELETE FROM "BidDocument" WHERE "announcementId"=$1', ann.id);
      await prisma.$executeRawUnsafe('DELETE FROM "AnnouncementAttachment" WHERE "announcementId"=$1', ann.id);
      await prisma.$executeRawUnsafe('DELETE FROM "Announcement" WHERE "id"=$1', ann.id);
    }
    const pmi = await prisma.bidProject.findUnique({ where: { id: projectId }, select: { projectManagementItemId: true } });
    if (pmi?.projectManagementItemId) {
      await prisma.$executeRawUnsafe('DELETE FROM "ProjectManagementStage" WHERE "projectManagementItemId"=$1', pmi.projectManagementItemId);
      await prisma.$executeRawUnsafe('DELETE FROM "ProjectManagementItem" WHERE "id"=$1', pmi.projectManagementItemId);
    }
    await prisma.$executeRawUnsafe('DELETE FROM "BidProject" WHERE "id"=$1', projectId);
  }
}

/** 监督留痕 */
function supervisionLog(projectId, action, result, role = '系统', riskFlag = '—') {
  return prisma.bidSupervisionLog.create({
    data: { projectId, time: now(), role, target: '解密演示', action, result, riskFlag },
  });
}

async function reset() {
  const demo = await prisma.bidProject.findFirst({ where: { projectCode: { startsWith: DEMO_CODE_PREFIX } } });
  if (!demo) {
    console.log('未找到演示项目（BID-DEMO-*），请先执行 create');
    return;
  }
  const t = now();
  await prisma.$transaction(async (tx) => {
    // 只清开标过程数据（会话/唱标记录/交流），供应商回执与加密标书保留
    await tx.$executeRawUnsafe('DELETE FROM "OpeningHallReadCursor" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe('DELETE FROM "OpeningHallMessage" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe('DELETE FROM "BidOpeningSession" WHERE "projectId"=$1', demo.id);
    await tx.$executeRawUnsafe('DELETE FROM "BidOpeningRecord" WHERE "projectId"=$1', demo.id);
    // 回执状态复位 + 阶段复位 OPENING（若曾完成开标/移交）
    await tx.$executeRawUnsafe(
      `UPDATE "BidSupplier" SET "decryptStatus"='PENDING', "confirmStatus"='PENDING', "checkInAt"=NULL, "lastSeenAt"=NULL WHERE "projectId"=$1`,
      demo.id,
    );
    // 时间口径刷新为当前时刻（fresh-time 默认行为，与 create 一致；开标=now、截标=now-1h、下载截止=now+30min）
    await tx.bidProject.update({
      where: { id: demo.id },
      data: {
        stage: 'OPENING',
        openTime: t,
        deadline: new Date(t.getTime() - 24 * 3600_000), // 截标=开标前 24h：BID_DEADLINE_BEFORE_OPENING_MS 口径（packages/shared/src/constants.ts）；CJS 脚本不 import shared，写字面量 24h
        downloadDeadline: new Date(t.getTime() + 30 * 60_000),
        evaluationDeadline: new Date(t.getTime() + 72 * 3600_000),
      },
    });
    // PMI 开标时间同步（:3005 开标确认面板展示口径）
    if (demo.projectManagementItemId) {
      await tx.projectManagementItem.update({
        where: { id: demo.projectManagementItemId },
        data: { bidOpeningTime: t.toISOString() },
      });
    }
    await tx.bidSupervisionLog.create({
      data: {
        projectId: demo.id, time: t, role: '系统', target: '解密演示',
        action: '演示重置', result: '回到「待组建开标会话」：解密/唱标/确认/交流已清空，开标时间已刷新为当前时刻', riskFlag: '—',
      },
    });
  });
  console.log(`✅ 已重置演示项目 ${demo.projectCode} → OPENING（待组建开标会话，开标时间=now）`);
  console.log(`   :3007 http://localhost:3007/bid/project/${demo.id}`);
}

async function create() {
  const src = await prisma.bidProject.findUnique({
    where: { projectCode: SOURCE_CODE },
    include: {
      suppliers: true,
      scoreItems: { include: { points: true } },
    },
  });
  if (!src) {
    console.error(`源项目 ${SOURCE_CODE} 不存在`);
    return;
  }
  const srcSubs = await prisma.supplierBidSubmission.findMany({ where: { projectId: src.id } });
  const srcAnn = await prisma.announcement.findFirst({ where: { relatedProjectCode: SOURCE_CODE, type: 'BID_NOTICE' } });
  const srcBidDoc = srcAnn ? await prisma.bidDocument.findUnique({ where: { announcementId: srcAnn.id } }) : null;
  const srcPmi = src.projectManagementItemId
    ? await prisma.projectManagementItem.findUnique({ where: { id: src.projectManagementItemId } })
    : null;
  const srcStages = srcPmi
    ? await prisma.projectManagementStage.findMany({ where: { projectManagementItemId: srcPmi.id }, orderBy: { stageOrder: 'asc' } })
    : [];

  // 若已有演示项目则整体重建（保证脚本幂等：随时跑随时得到全新副本）
  const existing = await prisma.bidProject.findFirst({ where: { projectCode: { startsWith: DEMO_CODE_PREFIX } } });
  if (existing) {
    console.log(`发现旧演示项目 ${existing.projectCode}，整体重建…`);
    await wipeProject(existing.id);
  }

  const t = now();
  const projectId = createId();
  const pmiId = createId();
  const annId = createId();
  const ts = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
  const projectCode = `${DEMO_CODE_PREFIX}${ts}`;
  const pmiCode = `JJ-DEMO-${ts}`;

  // ① PMI 宿主 + 阶段（1-5 COMPLETED、6-9 NOT_STARTED、currentStage=BID_EVALUATION）——须先于 BidProject（FK）
  await prisma.projectManagementItem.create({
    data: {
      id: pmiId,
      title: DEMO_NAME,
      requesterName: srcPmi?.requesterName ?? '彭强',
      requesterDepartment: srcPmi?.requesterDepartment ?? '采购中心',
      procurementMethod: srcPmi?.procurementMethod ?? src.procurementMethod,
      procurementCategory: srcPmi?.procurementCategory ?? '其他',
      procurementOrganizationForm: srcPmi?.procurementOrganizationForm ?? '—',
      isAnnualBudget: srcPmi?.isAnnualBudget ?? false,
      budgetAmount: srcPmi?.budgetAmount ?? Number(src.budget),
      projectReason: srcPmi?.projectReason ?? '（解密演示副本）',
      supplierRequirements: srcPmi?.supplierRequirements,
      currentStage: 'BID_EVALUATION',
      status: 'ACTIVE',
      createdById: srcPmi?.createdById,
      initiationDate: t,
      bidOpeningTime: t.toISOString(),
      invitedSuppliers: srcPmi?.invitedSuppliers,
      projectOverview: srcPmi?.projectOverview,
      projectCode: pmiCode,
      currentRound: 1,
    },
  });
  for (const st of srcStages) {
    await prisma.projectManagementStage.create({
      data: {
        id: createId(),
        projectManagementItemId: pmiId,
        stageKey: st.stageKey,
        stageName: st.stageName,
        stageOrder: st.stageOrder,
        status: st.status,
        note: st.note,
        completedAt: st.status === 'COMPLETED' ? t : null,
        round: st.round,
      },
    });
  }

  // ② BidProject（OPENING、开标时间=now、评分标准已发布、主持人=陈源远）
  await prisma.bidProject.create({
    data: {
      id: projectId,
      projectCode,
      name: DEMO_NAME,
      procurementMethod: src.procurementMethod,
      openTime: t,
      deadline: new Date(t.getTime() - 24 * 3600_000), // 截标=开标前 24h：BID_DEADLINE_BEFORE_OPENING_MS 口径（packages/shared/src/constants.ts）；CJS 脚本不 import shared，写字面量 24h
      stage: 'OPENING',
      riskNote: `${src.riskNote ?? ''}；（解密演示副本）`,
      budget: src.budget,
      contact: src.contact,
      qualification: src.qualification,
      scope: src.scope,
      bondAmount: src.bondAmount,
      bondRequired: src.bondRequired,
      qualityRequirement: src.qualityRequirement,
      scoreStandardPublishedAt: t,
      round: 1,
      projectManagementItemId: pmiId,
      downloadDeadline: new Date(t.getTime() + 30 * 60_000),
      isExtractionOnly: src.isExtractionOnly,
      ceilingPrice: src.ceilingPrice,
      evaluationMethod: src.evaluationMethod,
      priceFormulaConfig: src.priceFormulaConfig,
      currentRoundNo: 1,
      roundMode: src.roundMode,
      assignedHostUserId: src.assignedHostUserId,
      assignedAt: t,
      assignedByUserId: src.assignedByUserId,
      evaluationDeadline: new Date(t.getTime() + 72 * 3600_000),
    },
  });

  // ③ 公告 + 加密招标文件（复用 MinIO 密文对象与 KMS 封装的解密密钥）
  await prisma.announcement.create({
    data: {
      id: annId,
      title: DEMO_NAME,
      content: srcAnn?.content ?? `<p>${DEMO_NAME}</p>`,
      type: 'BID_NOTICE',
      status: 'PUBLISHED',
      summary: srcAnn?.summary,
      publishDate: t,
      isTop: false,
      viewCount: 0,
      relatedProjectCode: projectCode,
      authorId: srcAnn?.authorId,
      metadata: srcAnn?.metadata ?? {},
      aiSummary: srcAnn?.aiSummary,
      publicityEnd: srcAnn?.publicityEnd,
    },
  });
  if (srcBidDoc) {
    await prisma.bidDocument.create({
      data: {
        id: createId(),
        announcementId: annId,
        fileAssetId: srcBidDoc.fileAssetId,
        title: srcBidDoc.title,
        accessScope: srcBidDoc.accessScope,
        requirePayment: srcBidDoc.requirePayment,
        price: srcBidDoc.price,
        decryptKey: srcBidDoc.decryptKey,
        bidProjectId: projectId,
        downloadCount: 0,
      },
    });
  }

  // ④ 3 家供应商 + 加密标书（复用原 FileAsset 与密封密钥；回执编号重开新号段）
  const receiptBase = `TB-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-9`;
  for (let i = 0; i < src.suppliers.length; i++) {
    const s = src.suppliers[i];
    const sub = srcSubs.find((x) => x.supplierId === s.supplierId);
    await prisma.bidSupplier.create({
      data: {
        id: createId(),
        projectId,
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        downloadStatus: s.downloadStatus,
        submitStatus: s.submitStatus,
        encryptStatus: s.encryptStatus,
        receiptNo: `${receiptBase}${String(i + 1).padStart(2, '0')}`,
        decryptStatus: 'PENDING',
        confirmStatus: 'PENDING',
        bidValidity: s.bidValidity,
      },
    });
    if (sub) {
      await prisma.supplierBidSubmission.create({
        data: {
          id: createId(),
          supplierId: sub.supplierId,
          projectId,
          bidPrice: sub.bidPrice,
          deliveryPeriod: sub.deliveryPeriod,
          technicalFile: sub.technicalFile,
          businessFile: sub.businessFile,
          coverLetter: sub.coverLetter,
          status: 'submitted',
          submittedAt: t,
          technicalFileAssetId: sub.technicalFileAssetId,
          businessFileAssetId: sub.businessFileAssetId,
          coverLetterAssetId: sub.coverLetterAssetId,
          businessSealedKey: sub.businessSealedKey,
          coverLetterSealedKey: sub.coverLetterSealedKey,
          technicalSealedKey: sub.technicalSealedKey,
          fileHash: sub.fileHash,
          signature: sub.signature,
          signedAt: sub.signedAt,
          bidBondAssetId: sub.bidBondAssetId,
          serverSubmittedAt: t,
        },
      });
    }
  }

  // ⑤ 评分标准（5 项 + 全部得分点，新 id 拷贝）
  const itemIdMap = new Map();
  for (const it of src.scoreItems) {
    const newItemId = createId();
    itemIdMap.set(it.id, newItemId);
    await prisma.bidScoreItem.create({
      data: {
        id: newItemId,
        projectId,
        name: it.name,
        category: it.category,
        maxScore: it.maxScore,
        criteriaSource: it.criteriaSource,
        evidenceHint: it.evidenceHint,
        scoringCriteria: it.scoringCriteria,
      },
    });
    for (const p of it.points) {
      await prisma.bidScorePoint.create({
        data: {
          id: createId(),
          scoreItemId: newItemId,
          name: p.name,
          fullScore: p.fullScore,
          seq: p.seq,
          evidenceHint: p.evidenceHint,
          objective: p.objective,
          evidenceSection: p.evidenceSection,
          confidence: p.confidence,
          linkedRequirementIds: p.linkedRequirementIds,
        },
      });
    }
  }

  // ⑥ 另外抽取的 5 名专家（已确认参加；组长=仇海亮）
  for (const e of NEW_EXPERTS) {
    await prisma.bidExpert.create({
      data: {
        id: createId(),
        project: { connect: { id: projectId } },
        expertName: e.name,
        major: e.major,
        signedIn: false,
        avoidanceConfirmed: false,
        progress: 0,
        totalScore: 0,
        user: { connect: { id: e.userId } },
        invitationStatus: 'confirmed',
        expertRole: '正选',
        isLead: !!e.isLead,
        rsvpRespondedAt: t,
      },
    });
  }

  // ⑦ 留痕
  await supervisionLog(projectId, '项目复制创建', `副本自 ${SOURCE_CODE} 复制：OPENING 待组建会话、专家另抽 5 人、标书/招标文件复用密文对象`);

  console.log('✅ 解密演示项目已创建');
  console.log(`   BidProject : ${projectCode}  (${projectId})`);
  console.log(`   PMI        : ${pmiCode}  (${pmiId})`);
  console.log(`   供应商     : 3 家（${src.suppliers.map((s) => s.supplierName).join(' / ')}）`);
  console.log(`   专家       : ${NEW_EXPERTS.map((e) => `${e.name}(${e.major})`).join(' / ')}`);
  console.log(`   :3007 开标大厅  http://localhost:3007/bid/project/${projectId}`);
  console.log(`   :3005 开标确认  http://localhost:3005/projects?projectId=${pmiId}&panel=bid-confirm`);
  console.log('   随时运行 reset 回到「待组建会话」重演解密/唱标/交流。');
}

(async () => {
  try {
    if (MODE === 'reset') await reset();
    else await create();
  } catch (e) {
    console.error('脚本执行失败：', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
