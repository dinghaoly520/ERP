-- P1 波4 Task1：A-129/A-132/A-151/A-152/A-105 数据面
ALTER TABLE "ExpertProfile" ADD COLUMN "regionCode" TEXT;
ALTER TABLE "ExpertProfile" ADD COLUMN "expertLevel" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "reviewGroup" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "dutyRole" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "esignature" JSONB;
ALTER TABLE "BidExpert" ADD COLUMN "esignatureAt" TIMESTAMP(3);
ALTER TABLE "BidProject" ADD COLUMN "reportNotes" JSONB;
ALTER TABLE "BidSupplier" ADD COLUMN "bondReturnedAt" TIMESTAMP(3);
ALTER TABLE "BidSupplier" ADD COLUMN "bondReturnReason" TEXT;
CREATE TABLE "ExpertCert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certSn" TEXT NOT NULL,
    "certDn" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "alg" TEXT NOT NULL DEFAULT 'SM2',
    "bindingStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ExpertCert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpertCert_certSn_key" ON "ExpertCert"("certSn");
CREATE INDEX "ExpertCert_userId_bindingStatus_idx" ON "ExpertCert"("userId", "bindingStatus");
ALTER TABLE "ExpertCert" ADD CONSTRAINT "ExpertCert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
