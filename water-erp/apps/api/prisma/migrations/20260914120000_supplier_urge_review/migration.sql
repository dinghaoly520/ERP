-- 供应商催促审核（仅一次）：urgedAt 记录首次催促时间
ALTER TABLE "Supplier" ADD COLUMN "urgedAt" TIMESTAMP(3);
