-- C3 转非招标方式成交记录（CTS-EBS01 A-199）
-- CreateTable
CREATE TABLE "NonTenderDealRecord" (
    "id" TEXT NOT NULL,
    "bidProjectId" TEXT NOT NULL,
    "pmItemId" TEXT,
    "method" TEXT NOT NULL,
    "winnerSupplierId" TEXT,
    "winnerName" TEXT NOT NULL,
    "dealAmount" DECIMAL(14,2),
    "fileAssetId" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonTenderDealRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NonTenderDealRecord_bidProjectId_key" ON "NonTenderDealRecord"("bidProjectId");

-- CreateIndex
CREATE INDEX "NonTenderDealRecord_pmItemId_idx" ON "NonTenderDealRecord"("pmItemId");
