-- Add origin columns missing from DB after schema change
ALTER TABLE "BidProject" ADD COLUMN IF NOT EXISTS "round" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BidProject" ADD COLUMN IF NOT EXISTS "projectManagementItemId" TEXT;
