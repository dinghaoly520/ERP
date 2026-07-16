-- Surgical migration: add BidInvalidBid + BidSupplier.bidValidity
-- Generated as surgical (DB drift present: unapplied add_category_tree + OperationLog.avatar).
-- This migration ONLY adds the BidInvalidBid table and BidSupplier.bidValidity column.

-- AddColumn: BidSupplier.bidValidity
ALTER TABLE "BidSupplier" ADD COLUMN "bidValidity" TEXT NOT NULL DEFAULT 'valid';

-- CreateTable
CREATE TABLE "BidInvalidBid" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "scoreItemId" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invalid',
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "BidInvalidBid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidInvalidBid_projectId_supplierId_idx" ON "BidInvalidBid"("projectId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "BidInvalidBid_projectId_supplierId_scoreItemId_key" ON "BidInvalidBid"("projectId", "supplierId", "scoreItemId");

-- AddForeignKey
ALTER TABLE "BidInvalidBid" ADD CONSTRAINT "BidInvalidBid_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidInvalidBid" ADD CONSTRAINT "BidInvalidBid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidInvalidBid" ADD CONSTRAINT "BidInvalidBid_scoreItemId_fkey" FOREIGN KEY ("scoreItemId") REFERENCES "BidScoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
