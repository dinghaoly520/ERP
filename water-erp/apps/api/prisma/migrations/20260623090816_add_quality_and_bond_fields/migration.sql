-- AlterTable
ALTER TABLE "BidProject" ADD COLUMN     "bondAmount" DECIMAL(14,2),
ADD COLUMN     "bondRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityRequirement" TEXT;

-- AlterTable
ALTER TABLE "SupplierBidSubmission" ADD COLUMN     "bidBondAssetId" TEXT;

-- CreateIndex
CREATE INDEX "SupplierBidSubmission_bidBondAssetId_idx" ON "SupplierBidSubmission"("bidBondAssetId");
