-- M1：回收时间专门字段（3 年保留期起算点；updatedAt 会被任意更新刷新，不可作起算）
ALTER TABLE "ProjectManagementItem" ADD COLUMN "recycledAt" TIMESTAMP(3);
-- 存量已回收项目：用当前 updatedAt 回填近似值（早于 NULL 从严拒绝的策略，更平滑）
UPDATE "ProjectManagementItem" SET "recycledAt" = "updatedAt" WHERE status = 'RECYCLED' AND "recycledAt" IS NULL;
