-- AlterTable
ALTER TABLE "ai_bidder_results" ADD COLUMN     "requirementResponses" JSONB;

-- CreateTable
CREATE TABLE "bid_requirement_reviews" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidderResultId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_requirement_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_requirement_reviews_projectId_bidderResultId_expertId_r_key" ON "bid_requirement_reviews"("projectId", "bidderResultId", "expertId", "requirementId");
