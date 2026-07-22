-- #13 选取历史落库（替代 JSON 文件存储）。新增表，纯加性，不影响既有数据。
CREATE TABLE "SupplierSelectionHistory" (
    "id" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "classificationId" TEXT,
    "classificationName" TEXT,
    "resultSummary" TEXT NOT NULL,
    "recommendationCount" INTEGER NOT NULL,
    "candidatePool" INTEGER NOT NULL,
    "shortlistedIds" TEXT[] NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSelectionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierSelectionHistory_createdAt_idx" ON "SupplierSelectionHistory"("createdAt");
