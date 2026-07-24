-- 采购文件获取时间：在采购文件步骤随文件上传一并由 AI 提取，
-- 与项目概况、开标时间同列。后续作为发布公告中"采购文件下载时间限制"的数据来源。
-- 幂等：drift 环境下重复执行不报错。
ALTER TABLE "ProjectManagementItem" ADD COLUMN IF NOT EXISTS "documentAcquireTime" TEXT;
