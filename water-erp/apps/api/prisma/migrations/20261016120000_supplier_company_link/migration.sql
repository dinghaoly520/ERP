-- CreateEnum
CREATE TYPE "SupplierLinkStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED');

-- CreateTable
CREATE TABLE "SupplierCompanyLink" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "SupplierLinkStatus" NOT NULL DEFAULT 'PENDING',
    "reviewStage" TEXT,
    "note" TEXT,
    "rejectReason" TEXT,
    "appliedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCompanyLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCompanyLink_companyId_status_idx" ON "SupplierCompanyLink"("companyId", "status");

-- CreateIndex
CREATE INDEX "SupplierCompanyLink_supplierId_idx" ON "SupplierCompanyLink"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCompanyLink_supplierId_companyId_key" ON "SupplierCompanyLink"("supplierId", "companyId");

-- AddForeignKey
ALTER TABLE "SupplierCompanyLink" ADD CONSTRAINT "SupplierCompanyLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCompanyLink" ADD CONSTRAINT "SupplierCompanyLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

