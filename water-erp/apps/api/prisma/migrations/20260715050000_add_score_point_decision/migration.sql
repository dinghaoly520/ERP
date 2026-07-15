-- CreateTable
CREATE TABLE "BidScorePointDecision" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL,
    "awardedScore" DECIMAL(5,1) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidScorePointDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidScorePointDecision_supplierId_idx" ON "BidScorePointDecision"("supplierId");

-- CreateIndex
CREATE INDEX "BidScorePointDecision_expertId_supplierId_idx" ON "BidScorePointDecision"("expertId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "BidScorePointDecision_expertId_pointId_supplierId_key" ON "BidScorePointDecision"("expertId", "pointId", "supplierId");

-- AddForeignKey
ALTER TABLE "BidScorePointDecision" ADD CONSTRAINT "BidScorePointDecision_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "BidExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScorePointDecision" ADD CONSTRAINT "BidScorePointDecision_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "BidScorePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScorePointDecision" ADD CONSTRAINT "BidScorePointDecision_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
