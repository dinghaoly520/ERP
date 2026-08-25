-- P1-3①A：开标记录纸面签字（主持人/监督人扫描回传登记）
ALTER TABLE "BidOpeningSession" ADD COLUMN "hostSignScanFileId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN "supervisorSignScanFileId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN "openingSignRegisteredAt" TIMESTAMP(3);
ALTER TABLE "BidOpeningSession" ADD COLUMN "openingSignRegisteredBy" TEXT;
