-- C5（GB/T 43711 7.2.6）：采购文件澄清/修改（补遗）公告
-- AlterEnum
ALTER TYPE "AnnouncementType" ADD VALUE 'ADDENDUM';

-- AlterTable
ALTER TABLE "BidDocument" ADD COLUMN "addendumNo" INTEGER NOT NULL DEFAULT 0;
