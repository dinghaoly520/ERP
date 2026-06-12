-- AlterTable
ALTER TABLE "BidSupplier" ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "BidSupplier_supplierId_idx" ON "BidSupplier"("supplierId");

-- AddForeignKey
ALTER TABLE "BidSupplier" ADD CONSTRAINT "BidSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBidSubmission" ADD CONSTRAINT "SupplierBidSubmission_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
