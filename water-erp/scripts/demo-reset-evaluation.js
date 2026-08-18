#!/usr/bin/env node
/**
 * 演示状态恢复脚本 —— 把指定项目回退到「专家评标中」：
 *   - stage → EVALUATING；PMI 第 7 步进行中、第 8 步定标锁回、中标单位清空
 *   - 除指定「未评标专家」外，其余专家评分/核对/报告确认保留
 *   - 清除后置产物：评标结果、组长末签、签字包/签字登记、归档、回流包、中标公示
 *   - 监督日志保留 + 新增「演示重置」记录；AI 分析结果保留
 *
 * 用法（在 water-erp/apps/api 下）：
 *   node ../../scripts/demo-reset-evaluation.js [projectCode] [未评标专家姓名]
 *   默认：BID-1786934256839 / 麦高飞
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', 'apps', 'api', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const { createRequire } = require('module');
const apiRequire = createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_CODE = process.argv[2] || 'BID-1786934256839';
const SKIP_EXPERT = process.argv[3] || '麦高飞';

async function main() {
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) { console.error(`项目 ${PROJECT_CODE} 不存在`); return; }
  const pmiId = project.projectManagementItemId;

  await prisma.$transaction(async (tx) => {
    // ① 清除后置产物
    await tx.$executeRawUnsafe('DELETE FROM "BidSignPacket" WHERE "projectId"=$1', project.id).catch(() => {});
    await tx.$executeRawUnsafe('DELETE FROM "BidArchiveItem" WHERE "projectId"=$1', project.id).catch(() => {});
    await tx.$executeRawUnsafe('DELETE FROM "BidEvaluationResult" WHERE "projectId"=$1', project.id).catch(() => {});
    const ann = await tx.announcement.findFirst({ where: { relatedProjectCode: project.projectCode, type: 'WIN_NOTICE' } });
    if (ann) await tx.$executeRawUnsafe('DELETE FROM "Announcement" WHERE "id"=$1', ann.id);

    // ② 指定专家回退未评标（保留签到/回避/身份核验）
    await tx.bidExpert.updateMany({
      where: { projectId: project.id, expertName: SKIP_EXPERT },
      data: { reportConfirmed: false, reportConfirmedAt: null, progress: 0, totalScore: 0, scoreDraft: null },
    });
    // signStatus 是非空枚举，走原生 SQL 清空
    await tx.$executeRawUnsafe(
      `UPDATE "BidExpert" SET "signStatus"='PENDING', "signStatusAt"=NULL, "signScanFileId"=NULL, "dissentingOpinion"=NULL, "dissentingReason"=NULL WHERE "projectId"=$1 AND "expertName"=$2`,
      project.id, SKIP_EXPERT,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM "BidScoreRecord" WHERE "expertId" IN (SELECT "id" FROM "BidExpert" WHERE "projectId"=$1 AND "expertName"=$2)`,
      project.id, SKIP_EXPERT,
    );

    // ③ BidProject 回退：EVALUATING、组长末签清除
    await tx.bidProject.update({
      where: { id: project.id },
      data: { stage: 'EVALUATING', leaderCoSigned: false, leaderCoSignedAt: null },
    });

    // ④ PMI 回退：第 7 步进行中、第 8 步锁回、中标单位清空
    if (pmiId) {
      await tx.$executeRawUnsafe(
        `UPDATE "ProjectManagementStage" SET "status"='IN_PROGRESS', "completedAt"=NULL WHERE "projectManagementItemId"=$1 AND "stageKey"='BID_EVALUATION'`,
        pmiId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ProjectManagementStage" SET "status"='NOT_STARTED', "completedAt"=NULL WHERE "projectManagementItemId"=$1 AND "stageKey" IN ('AWARD_DECISION','CONTRACT')`,
        pmiId,
      );
      await tx.projectManagementItem.update({
        where: { id: pmiId },
        data: { currentStage: 'BID_EVALUATION', awardedSupplier: null },
      });
    }

    // ⑤ 留痕
    await tx.bidSupervisionLog.create({
      data: {
        projectId: project.id, time: new Date(), role: '系统', target: '演示重置',
        action: '回退至专家评标', result: `阶段回退 EVALUATING；${SKIP_EXPERT} 保留未评标，其余专家评标完成保留；评标结果/签字/归档/公示已清除`,
        riskFlag: '—',
      },
    });
  });

  const experts = await prisma.bidExpert.findMany({
    where: { projectId: project.id, expertRole: '正选' },
    orderBy: { createdAt: 'asc' },
  });
  console.log('✅ 已恢复到专家评标阶段');
  console.log(`   ${experts.map(e => `${e.expertName}${e.reportConfirmed ? '（已确认）' : '（未评标）'}`).join(' / ')}`);
  console.log(`   :3007 http://localhost:3007/bid/project/${project.id}?tab=evaluate`);
}

main().catch((e) => { console.error('脚本执行失败：', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
