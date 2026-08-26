-- GB/T 43711 两段式成交公示 + 直接采购理由公示（A3/C1）
-- AlterEnum
ALTER TYPE "AnnouncementType" ADD VALUE 'PRE_WIN_NOTICE';

-- AlterTable
ALTER TABLE "BidProject" ADD COLUMN "directSourcingReason" TEXT;
