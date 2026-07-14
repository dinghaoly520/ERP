-- AlterTable
ALTER TABLE "BidExpert" ADD COLUMN     "aiConsentAt" TIMESTAMP(3),
ADD COLUMN     "aiConsentConfirmed" BOOLEAN NOT NULL DEFAULT false;
