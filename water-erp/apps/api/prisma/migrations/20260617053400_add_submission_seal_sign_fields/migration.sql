-- AlterTable
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "technicalSealedKey"    TEXT;
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "businessSealedKey"     TEXT;
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "coverLetterSealedKey"  TEXT;
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "fileHash"              TEXT;
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "signature"             TEXT;
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "signedAt"              TIMESTAMP(3);
