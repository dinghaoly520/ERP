-- 供应商审核历史（不可变留痕）：完整快照 + 验证人 + 是否同意 + 时间 + 理由
CREATE TABLE IF NOT EXISTS "SupplierApprovalRecord" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierApprovalRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupplierApprovalRecord_supplierId_createdAt_idx" ON "SupplierApprovalRecord"("supplierId","createdAt");
ALTER TABLE "SupplierApprovalRecord" ADD CONSTRAINT "SupplierApprovalRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierApprovalRecord" ADD CONSTRAINT "SupplierApprovalRecord_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
