-- CreateTable
CREATE TABLE "BidScoreReview" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidScoreReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidScoreReview_expertId_supplierId_idx" ON "BidScoreReview"("expertId", "supplierId");

-- CreateIndex
CREATE INDEX "BidScoreReview_projectId_supplierId_idx" ON "BidScoreReview"("projectId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "BidScoreReview_expertId_projectId_supplierId_key" ON "BidScoreReview"("expertId", "projectId", "supplierId");

-- AddForeignKey
ALTER TABLE "BidScoreReview" ADD CONSTRAINT "BidScoreReview_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "BidExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScoreReview" ADD CONSTRAINT "BidScoreReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScoreReview" ADD CONSTRAINT "BidScoreReview_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
