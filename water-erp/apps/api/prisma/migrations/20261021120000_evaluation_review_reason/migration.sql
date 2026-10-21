-- 评价多开·方案B：两域评价表补「复评事由」列（频次闸审计留痕，可空免回填）
ALTER TABLE "ExpertEvaluation" ADD COLUMN "reviewReason" TEXT;
ALTER TABLE "SupplierEvaluation" ADD COLUMN "reviewReason" TEXT;
