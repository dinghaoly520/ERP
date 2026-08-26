-- 追赶迁移：开标签字扫描三列（schema 已入库但缺迁移——并行会话竞争时被 W1-Task2 提交卷入）
ALTER TABLE "BidOpeningSession" ADD COLUMN "hostSignScanFileId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN "supervisorSignScanFileId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN "openingSignRegisteredBy" TEXT;
