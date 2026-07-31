-- CreateTable: P5 评分修订历史
CREATE TABLE "BidScoreRecordHistory" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "scoreItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "score" DECIMAL(5,1) NOT NULL,
    "passed" BOOLEAN,
    "reason" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidScoreRecordHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BidScoreRecordHistory_recordId_idx" ON "BidScoreRecordHistory"("recordId");
CREATE INDEX "BidScoreRecordHistory_expertId_scoreItemId_supplierId_idx" ON "BidScoreRecordHistory"("expertId", "scoreItemId", "supplierId");
