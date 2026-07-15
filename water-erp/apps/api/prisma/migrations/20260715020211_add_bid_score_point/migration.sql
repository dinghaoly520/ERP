-- CreateTable
CREATE TABLE "BidScorePoint" (
    "id" TEXT NOT NULL,
    "scoreItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullScore" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "evidenceHint" TEXT,
    "objective" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidScorePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidScorePoint_scoreItemId_idx" ON "BidScorePoint"("scoreItemId");

-- AddForeignKey
ALTER TABLE "BidScorePoint" ADD CONSTRAINT "BidScorePoint_scoreItemId_fkey" FOREIGN KEY ("scoreItemId") REFERENCES "BidScoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
