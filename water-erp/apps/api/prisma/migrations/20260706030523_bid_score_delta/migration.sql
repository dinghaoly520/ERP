-- CreateTable
CREATE TABLE "bid_score_deltas" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "scoreItemId" TEXT NOT NULL,
    "aiScore" DECIMAL(5,1) NOT NULL,
    "expertScore" DECIMAL(5,1) NOT NULL,
    "delta" DECIMAL(5,1) NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "aiConfidence" DECIMAL(3,2),
    "expertReportConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_score_deltas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bid_score_deltas_projectId_idx" ON "bid_score_deltas"("projectId");

-- CreateIndex
CREATE INDEX "bid_score_deltas_expertId_idx" ON "bid_score_deltas"("expertId");

-- CreateIndex
CREATE UNIQUE INDEX "bid_score_deltas_expertId_scoreItemId_supplierId_key" ON "bid_score_deltas"("expertId", "scoreItemId", "supplierId");
