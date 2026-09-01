-- 开标确认电子签名归档（A-114）：供应商确认开标记录的 SM2/SM3 签名
ALTER TABLE "BidOpeningRecord" ADD COLUMN "confirmSignature" JSONB;
ALTER TABLE "BidOpeningRecord" ADD COLUMN "confirmSignedAt" TIMESTAMP(3);
