-- 三级审核意见附件（2026-09-30）：SupplierApprovalRecord.attachmentIds
ALTER TABLE "SupplierApprovalRecord" ADD COLUMN "attachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
