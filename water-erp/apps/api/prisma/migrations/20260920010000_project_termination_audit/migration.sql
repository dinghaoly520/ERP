-- 项目终止留痕补齐（2026-09-20）：终止人 + 终止时资料快照
ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "terminatedById" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "terminationSnapshot" JSONB;

ALTER TABLE "ProjectManagementItem"
  ADD CONSTRAINT "ProjectManagementItem_terminatedById_fkey"
  FOREIGN KEY ("terminatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
