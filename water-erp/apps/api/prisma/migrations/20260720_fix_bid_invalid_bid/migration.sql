-- Fix BidInvalidBid schema vs DB drift
-- ① decidedAt → createdAt (DB has 'decidedAt' from original migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BidInvalidBid' AND column_name = 'decidedAt') THEN
    ALTER TABLE "BidInvalidBid" RENAME COLUMN "decidedAt" TO "createdAt";
  END IF;
END $$;

-- ② Add updatedAt if missing
ALTER TABLE "BidInvalidBid" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- ③ Fix supplier FK: drop old (→ Supplier), create new (→ BidSupplier)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BidInvalidBid_supplierId_fkey') THEN
    ALTER TABLE "BidInvalidBid" DROP CONSTRAINT "BidInvalidBid_supplierId_fkey";
  END IF;
END $$;
ALTER TABLE "BidInvalidBid" ADD CONSTRAINT "BidInvalidBid_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ④ Fix defaults (original migration omitted them)
ALTER TABLE "BidInvalidBid" ALTER COLUMN "failCount" SET DEFAULT 0;
ALTER TABLE "BidInvalidBid" ALTER COLUMN "totalCount" SET DEFAULT 0;
