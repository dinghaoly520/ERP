-- AlterTable
ALTER TABLE "BidScoreRecord" ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "BidScoreRecord_supplierId_idx" ON "BidScoreRecord"("supplierId");

-- AddForeignKey
ALTER TABLE "BidScoreRecord" ADD CONSTRAINT "BidScoreRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
