-- 2026-09-14 唱标金额单位戳：dual-v2 轨金额=万元裸数字，单位此前隐含在 envelopeVersion——
-- 落列自描述 + 存量回填（dual-v2 投递的开标记录 → '万元'），读端优先取本列。
ALTER TABLE "BidOpeningRecord" ADD COLUMN "amountUnit" TEXT;

UPDATE "BidOpeningRecord" r
SET "amountUnit" = '万元'
WHERE r."bidSupplierId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "BidSupplier" bs
    JOIN "SupplierBidSubmission" s
      ON s."supplierId" = bs."supplierId" AND s."projectId" = bs."projectId"
    WHERE bs."id" = r."bidSupplierId"
      AND s."envelopeVersion" = 'dual-v2'
  );
