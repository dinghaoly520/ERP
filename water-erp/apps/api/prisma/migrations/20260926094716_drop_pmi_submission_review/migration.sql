-- 方案A（2026-09-26）：删除立项受理审核留痕列（A-36/37）
-- 唯一历史留痕（JJ-2026091005：2026-09-10 彭强递交 / Swhi-CGZX-admin 受理通过）已书面存档于
-- docs/cts-ebs01-self-declaration/豁免声明-D2.md 移除注记，原列随本迁移删除。
-- FK 约束（ProjectManagementItem_submittedById_fkey / _reviewedById_fkey）随列自动级联删除。

ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "reviewStatus";
ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "submittedAt";
ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "submittedById";
ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "reviewedAt";
ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "reviewedById";
ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "reviewComment";
