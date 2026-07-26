-- AlterTable
ALTER TABLE "BidOpeningSession" ADD COLUMN "handoverAssetId" TEXT;
ALTER TABLE "BidOpeningSession" ADD COLUMN "handoverAt" TIMESTAMP(3);
