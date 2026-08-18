#!/usr/bin/env node
/**
 * 演示专家互换脚本：把 A 专家重置为初始未评状态，把 B 专家补成已完成（评分/核对/报告确认）。
 * 评分数据按参考专家 C 的评分记录克隆（同分数同理由）。
 *
 * 用法（在 water-erp/apps/api 下）：
 *   node ../../scripts/demo-swap-experts.js [项目编号] [重置专家] [补全专家] [克隆来源专家]
 *   默认：BID-1786934256839 / 李自繁 / 麦高飞 / 柳序先
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
const { createId } = apiRequire('@paralleldrive/cuid2');
const prisma = new PrismaClient();

const PROJECT_CODE = process.argv[2] || 'BID-1786934256839';
const RESET_EXPERT = process.argv[3] || '李自繁';
const COMPLETE_EXPERT = process.argv[4] || '麦高飞';
const CLONE_FROM = process.argv[5] || '柳序先';

async function main() {
  const project = await prisma.bidProject.findUnique({ where: { projectCode: PROJECT_CODE } });
  if (!project) { console.error(`项目 ${PROJECT_CODE} 不存在`); return; }
  const exp = async (name) => prisma.bidExpert.findFirst({ where: { projectId: project.id, expertName: name, expertRole: '正选' } });

  const resetExp = await exp(RESET_EXPERT);
  const completeExp = await exp(COMPLETE_EXPERT);
  const cloneExp = await exp(CLONE_FROM);
  if (!resetExp) { console.error(`未找到专家 ${RESET_EXPERT}`); return; }
  if (!completeExp) { console.error(`未找到专家 ${COMPLETE_EXPERT}`); return; }
  if (!cloneExp) { console.error(`未找到克隆来源专家 ${CLONE_FROM}`); return; }

  await prisma.$transaction(async (tx) => {
    // ① 重置 A：删评分、清状态（保留签到/回避/身份核验；组长身份 isLead 保留）
    await tx.$executeRawUnsafe('DELETE FROM "BidScoreRecord" WHERE "expertId"=$1', resetExp.id);
    await tx.$executeRawUnsafe(
      `UPDATE "BidExpert" SET "reportConfirmed"=false, "reportConfirmedAt"=NULL, "progress"=0, "totalScore"=0, "scoreDraft"=NULL, "signStatus"='PENDING', "signStatusAt"=NULL, "signScanFileId"=NULL, "dissentingOpinion"=NULL, "dissentingReason"=NULL WHERE "id"=$1`,
      resetExp.id,
    );

    // ② 补全 B：克隆来源专家评分记录 + 完成状态
    const srcRecords = await tx.bidScoreRecord.findMany({ where: { expertId: cloneExp.id } });
    if (srcRecords.length === 0) { throw new Error(`克隆来源 ${CLONE_FROM} 无评分记录`); }
    srcCount = srcRecords.length;
    for (const r of srcRecords) {
      await tx.bidScoreRecord.create({
        data: {
          id: createId(), expertId: completeExp.id, supplierId: r.supplierId, scoreItemId: r.scoreItemId,
          score: r.score, passed: r.passed, reason: r.reason,
        },
      });
    }
    const total = srcRecords.reduce((s, r) => s + Number(r.score), 0);
    await tx.bidExpert.update({
      where: { id: completeExp.id },
      data: { reportConfirmed: true, reportConfirmedAt: new Date(), progress: 100, totalScore: total },
    });
    // 组长末签重置（演示从确认环节重走）
    await tx.bidProject.update({ where: { id: project.id }, data: { leaderCoSigned: false, leaderCoSignedAt: null } });

    await tx.bidSupervisionLog.create({
      data: {
        projectId: project.id, time: new Date(), role: '系统', target: '演示互换',
        action: '演示专家状态互换',
        result: `${RESET_EXPERT} 重置为未评标（保留组长身份）；${COMPLETE_EXPERT} 已补全评分与报告确认（克隆自 ${CLONE_FROM}）；组长末签已清除`,
        riskFlag: '—',
      },
    });
  });

  console.log('✅ 互换完成');
  console.log(`   ${RESET_EXPERT} → 未评标（组长身份保留，可演示完整打分+末签流程）`);
  console.log(`   ${COMPLETE_EXPERT} → 已完成（评分/核对/报告确认，${srcCount} 条评分记录）`);
  console.log(`   :3006 http://localhost:3006/evaluate/${project.id}`);
}

let srcCount = 0;
main().catch((e) => { console.error('脚本执行失败：', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
