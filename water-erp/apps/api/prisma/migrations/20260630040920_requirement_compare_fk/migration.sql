-- AddForeignKey
ALTER TABLE "bid_requirement_reviews" ADD CONSTRAINT "bid_requirement_reviews_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_requirement_reviews" ADD CONSTRAINT "bid_requirement_reviews_bidderResultId_fkey" FOREIGN KEY ("bidderResultId") REFERENCES "ai_bidder_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_requirement_reviews" ADD CONSTRAINT "bid_requirement_reviews_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "BidExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
