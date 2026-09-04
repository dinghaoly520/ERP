-- 供应商自有档案（合同/框架协议自建留存）
CREATE TABLE "SupplierOwnArchive" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "refCode" TEXT,
    "counterparty" TEXT,
    "amount" TEXT,
    "signDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "scope" TEXT,
    "note" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierOwnArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierOwnArchive_supplierId_category_idx" ON "SupplierOwnArchive"("supplierId", "category");
CREATE INDEX "SupplierOwnArchive_endDate_idx" ON "SupplierOwnArchive"("endDate");
ALTER TABLE "SupplierOwnArchive" ADD CONSTRAINT "SupplierOwnArchive_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
