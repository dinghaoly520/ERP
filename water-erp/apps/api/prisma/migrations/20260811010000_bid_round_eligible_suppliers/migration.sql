-- AlterTable
ALTER TABLE "BidRound" ADD COLUMN "eligibleSupplierIds" text[] NOT NULL DEFAULT ARRAY[]::text[];
