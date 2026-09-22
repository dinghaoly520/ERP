-- 2026-09-22：AttachmentVersion.changeSummary 落列（schema 已有、DB 缺失的漂移修复）
-- 触发：归档四性检测 include versions 查询 P2022（演示项目补传阶段附件后暴露）
ALTER TABLE "AttachmentVersion" ADD COLUMN "changeSummary" TEXT;
