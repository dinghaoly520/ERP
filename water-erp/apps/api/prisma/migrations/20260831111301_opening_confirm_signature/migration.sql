-- A-114（P1 波2 Task1）：供应商确认开标记录的 SM2/SM3 电子签名归档列
-- migrate dev --create-only 因存量 4 处刻意偏离（DB 缺迁移史所建索引）触发 reset 提示而中止，按仓库铁律手写同构 SQL + db execute + resolve --applied
ALTER TABLE "BidOpeningRecord" ADD COLUMN "confirmSignature" JSONB;
ALTER TABLE "BidOpeningRecord" ADD COLUMN "confirmSignedAt" TIMESTAMP(3);
