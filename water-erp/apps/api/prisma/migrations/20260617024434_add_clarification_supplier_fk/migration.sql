-- AlterTable
ALTER TABLE "BidClarification" ADD COLUMN     "supplierId" TEXT;

-- AddForeignKey
ALTER TABLE "BidClarification" ADD CONSTRAINT "BidClarification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
