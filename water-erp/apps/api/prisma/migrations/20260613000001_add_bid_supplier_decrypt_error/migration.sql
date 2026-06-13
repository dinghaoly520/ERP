-- AlterTable: add decryptError field for recording decryption failure reasons
ALTER TABLE "BidSupplier" ADD COLUMN "decryptError" TEXT;
