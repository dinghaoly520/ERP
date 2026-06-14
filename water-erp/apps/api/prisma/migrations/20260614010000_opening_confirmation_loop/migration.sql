-- 供应商开标确认闭环：ConfirmStatus 增加 DISPUTED；BidOpeningRecord 增加确认/异议字段
-- ALTER TYPE ... ADD VALUE 不能在事务内执行（PG < 12 限制），单独语句执行
ALTER TYPE "ConfirmStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

ALTER TABLE "BidOpeningRecord"
  ADD COLUMN "bidSupplierId" TEXT,
  ADD COLUMN "objectionReason" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "handledAt" TIMESTAMP(3),
  ADD COLUMN "handledBy" TEXT,
  ADD COLUMN "handleResult" TEXT;

CREATE INDEX "BidOpeningRecord_bidSupplierId_idx" ON "BidOpeningRecord"("bidSupplierId");
