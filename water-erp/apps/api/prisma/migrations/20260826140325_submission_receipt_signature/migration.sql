-- W11-①（CTS A-101）：投标回执 SM2 签名存档
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "receiptSignature" JSONB;
ALTER TABLE "SupplierBidSubmission" ADD COLUMN "receiptSignedAt" TIMESTAMP(3);
