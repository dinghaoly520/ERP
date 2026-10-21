-- 异议工单归属公司（2026-10-21）：供应商提交时自选（限本人 APPROVED SupplierCompanyLink），
-- 决定异议出现在哪家公司的 leader 受理板。存量 null=未归属，仅 admin 可见可操作。
ALTER TABLE "SupplierObjection" ADD COLUMN "companyId" TEXT;
ALTER TABLE "SupplierObjection" ADD COLUMN "companyName" TEXT;
CREATE INDEX "SupplierObjection_companyId_idx" ON "SupplierObjection"("companyId");
