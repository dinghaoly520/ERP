-- 追赶迁移：开标签字扫描三列（schema 已入库但缺迁移——并行会话竞争时被 W1-Task2 提交卷入）
-- 幂等化（2026-08-28）：三列与 20260825020000_opening_sign_scans 重叠，全链重放（shadow DB / CI 全新库 migrate deploy）必撞 duplicate column；本迁移从未在任何环境成功执行过（dev 库系 resolve --applied 跳过执行），IF NOT EXISTS 对存量环境零影响
ALTER TABLE "BidOpeningSession" ADD COLUMN IF NOT EXISTS "hostSignScanFileId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN IF NOT EXISTS "supervisorSignScanFileId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN IF NOT EXISTS "openingSignRegisteredBy" TEXT;
