-- AlterTable: BidExpert 加保密承诺 + 评标纪律签署字段 (P4)
ALTER TABLE "BidExpert" ADD COLUMN "confidentialityAgreed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BidExpert" ADD COLUMN "confidentialityAgreedAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN "disciplineAgreed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BidExpert" ADD COLUMN "disciplineAgreedAt" TIMESTAMP(3);
