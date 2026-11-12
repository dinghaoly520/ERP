-- 移除记录新增「终止时简报」快照列（spec 2026-11-12 §9 增补：用户裁定记录中展示终止时简报）。
-- 本地库迁移漂移，走手写 DDL + db execute + resolve --applied 链。
ALTER TABLE "ProjectDeletionRecord" ADD COLUMN "analysisSummary" TEXT;
