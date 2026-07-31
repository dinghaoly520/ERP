-- AlterTable: BidProject 加多轮报价字段
ALTER TABLE "BidProject" ADD COLUMN "currentRoundNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BidProject" ADD COLUMN "roundMode" TEXT;

-- CreateTable: BidRound
CREATE TABLE "BidRound" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "roundType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BidRound_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidRound_projectId_roundNo_key" ON "BidRound"("projectId", "roundNo");
CREATE INDEX "BidRound_projectId_idx" ON "BidRound"("projectId");
ALTER TABLE "BidRound" ADD CONSTRAINT "BidRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE;

-- CreateTable: BidQuote
CREATE TABLE "BidQuote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "bidSupplierId" TEXT NOT NULL,
    "quotePrice" DECIMAL(14,2) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'sealed',
    CONSTRAINT "BidQuote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidQuote_roundId_bidSupplierId_key" ON "BidQuote"("roundId", "bidSupplierId");
CREATE INDEX "BidQuote_roundId_idx" ON "BidQuote"("roundId");
ALTER TABLE "BidQuote" ADD CONSTRAINT "BidQuote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BidRound"("id") ON DELETE CASCADE;
