-- AddForeignKey
ALTER TABLE "SupplierBidSubmission" ADD CONSTRAINT "SupplierBidSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
