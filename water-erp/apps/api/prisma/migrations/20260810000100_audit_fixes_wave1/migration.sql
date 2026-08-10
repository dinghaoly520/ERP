-- Wave 1: Audit fixes schema changes
-- 1. BidInvalidBid: scoreItemId nullable + add source column + restructure unique constraint
-- 2. BidExpert: add isPurchaserRepresentative + dissentingOpinion + dissentingReason

-- ── BidInvalidBid changes ──

-- Add source column (default 'passfail' for existing data)
ALTER TABLE "BidInvalidBid" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'passfail';

-- Backfill: existing '__dispute__' / '__manual__' scoreItemId → source + NULL scoreItemId
UPDATE "BidInvalidBid" SET source = 'dispute', "scoreItemId" = NULL WHERE "scoreItemId" = '__dispute__';
UPDATE "BidInvalidBid" SET source = 'manual',  "scoreItemId" = NULL WHERE "scoreItemId" = '__manual__';

-- Make scoreItemId nullable
ALTER TABLE "BidInvalidBid" ALTER COLUMN "scoreItemId" DROP NOT NULL;

-- Replace FK: drop old (CASCADE), add new (SET NULL for nullable)
ALTER TABLE "BidInvalidBid" DROP CONSTRAINT IF EXISTS "BidInvalidBid_scoreItemId_fkey";
ALTER TABLE "BidInvalidBid" ADD CONSTRAINT "BidInvalidBid_scoreItemId_fkey"
  FOREIGN KEY ("scoreItemId") REFERENCES "BidScoreItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Replace unique constraint: [projectId, supplierId, scoreItemId] → [projectId, supplierId, source]
DROP INDEX IF EXISTS "BidInvalidBid_projectId_supplierId_scoreItemId_key";
CREATE UNIQUE INDEX "BidInvalidBid_projectId_supplierId_source_key"
  ON "BidInvalidBid"("projectId", "supplierId", "source");

-- ── BidExpert changes ──

ALTER TABLE "BidExpert" ADD COLUMN "isPurchaserRepresentative" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BidExpert" ADD COLUMN "dissentingOpinion" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "dissentingReason" TEXT;
