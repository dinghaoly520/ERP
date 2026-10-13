-- I9 修复：CaSigningCertificateClaim 外键补齐（绑定行/owner 类型一致性）
-- 合同 §2.6：supplierBindingId→SupplierCert(id)、expertBindingId→ExpertCert(id)、
-- owner 与 binding 同类型 CHECK（全 supplier 或全 expert）

ALTER TABLE "CaSigningCertificateClaim"
  ADD CONSTRAINT "CaSigningCertificateClaim_supplierBindingId_fkey"
  FOREIGN KEY ("supplierBindingId") REFERENCES "SupplierCert"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CaSigningCertificateClaim"
  ADD CONSTRAINT "CaSigningCertificateClaim_expertBindingId_fkey"
  FOREIGN KEY ("expertBindingId") REFERENCES "ExpertCert"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CaSigningCertificateClaim"
  ADD CONSTRAINT "claim_owner_binding_type_consistent" CHECK (
    ("supplierId" IS NULL AND "supplierBindingId" IS NULL AND "expertBindingId" IS NULL) OR
    ("supplierId" IS NOT NULL AND "expertUserId" IS NULL) OR
    ("supplierId" IS NULL AND "expertUserId" IS NOT NULL)
  );
