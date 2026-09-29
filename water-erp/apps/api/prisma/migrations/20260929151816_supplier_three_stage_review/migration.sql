-- 三级供应商注册审批（2026-09-29）：Supplier.reviewStage + SupplierApprovalRecord.stage
ALTER TABLE "Supplier" ADD COLUMN "reviewStage" TEXT;
ALTER TABLE "SupplierApprovalRecord" ADD COLUMN "stage" TEXT;
-- 存量在审供应商回填到首级 STAFF（从头走三级，安全）
UPDATE "Supplier" SET "reviewStage" = 'STAFF' WHERE "status" IN ('PENDING', 'RETURNED');
CREATE INDEX "Supplier_reviewStage_idx" ON "Supplier"("reviewStage");
