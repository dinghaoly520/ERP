-- 项目终止（2026-09-20）：
-- 1) ProjectManagementStatus 枚举加 TERMINATED（终止项目进「已终止」列表，只读）
-- 2) ProjectManagementItem 加终止留痕字段
-- 3) ProcurementRound 加 terminationReason（终止项目写入台账，红字展示）

ALTER TYPE "ProjectManagementStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "terminationReason" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "terminatedAt" TIMESTAMP(3);
ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "terminatedStage" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "terminatedProcurementRoundId" TEXT;

ALTER TABLE "ProcurementRound" ADD COLUMN IF NOT EXISTS "terminationReason" TEXT;
