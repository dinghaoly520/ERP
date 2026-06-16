-- AlterTable
ALTER TABLE "BidExpert" ADD COLUMN     "conflictedSupplierIds" JSONB NOT NULL DEFAULT '[]';
