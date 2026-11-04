-- 专家 AI 综合评价（2026-11-04）：详情页「履职备注」区块改为 AI 生成的综合评价，
-- 每月 1 日 00:00 由 Scheduler 全量刷新；无履职数据的专家不生成（防无据编造）。
ALTER TABLE "ExpertProfile" ADD COLUMN "aiEvaluation" TEXT;
ALTER TABLE "ExpertProfile" ADD COLUMN "aiEvaluatedAt" TIMESTAMP(3);
