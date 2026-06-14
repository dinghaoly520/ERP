-- 评标结果闭环：专家报告锁定 + 评标结果汇总模型
ALTER TABLE "BidExpert"
  ADD COLUMN "reportConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reportConfirmedAt" TIMESTAMP(3);

CREATE TABLE "BidEvaluationResult" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "totalScore" DECIMAL(6,2) NOT NULL,
  "averageScore" DECIMAL(6,2) NOT NULL,
  "rank" INTEGER NOT NULL,
  "recommended" BOOLEAN NOT NULL DEFAULT false,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BidEvaluationResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidEvaluationResult_projectId_supplierId_key" ON "BidEvaluationResult"("projectId", "supplierId");
CREATE INDEX "BidEvaluationResult_projectId_rank_idx" ON "BidEvaluationResult"("projectId", "rank");

ALTER TABLE "BidEvaluationResult"
  ADD CONSTRAINT "BidEvaluationResult_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
