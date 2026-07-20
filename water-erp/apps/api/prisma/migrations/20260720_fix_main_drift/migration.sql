-- Fix main drift (4 items accumulated over prior PRs):
-- ① BidScoreReview supplier FK onDelete RESTRICT → Cascade
-- ② BidScoreReview index alignment
-- ③ BidExpert missing columns (isLead, expertRole, invitationStatus)
-- ④ ScoreTemplate table

-- ── ① BidScoreReview supplier FK onDelete mismatch ──
ALTER TABLE "BidScoreReview" DROP CONSTRAINT IF EXISTS "BidScoreReview_supplierId_fkey";
ALTER TABLE "BidScoreReview" ADD CONSTRAINT "BidScoreReview_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ② BidScoreReview index alignment ──
DROP INDEX IF EXISTS "BidScoreReview_expertId_supplierId_idx";
DROP INDEX IF EXISTS "BidScoreReview_projectId_supplierId_idx";
CREATE INDEX IF NOT EXISTS "BidScoreReview_projectId_expertId_idx" ON "BidScoreReview"("projectId", "expertId");

-- ── ③ BidExpert 3 columns missing from DB ──
ALTER TABLE "BidExpert" ADD COLUMN IF NOT EXISTS "isLead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BidExpert" ADD COLUMN IF NOT EXISTS "expertRole" TEXT NOT NULL DEFAULT '正选';
ALTER TABLE "BidExpert" ADD COLUMN IF NOT EXISTS "invitationStatus" TEXT NOT NULL DEFAULT 'pending';

-- ── ④ ScoreTemplate new model ──
CREATE TABLE IF NOT EXISTS "ScoreTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ScoreTemplate_createdById_idx" ON "ScoreTemplate"("createdById");
