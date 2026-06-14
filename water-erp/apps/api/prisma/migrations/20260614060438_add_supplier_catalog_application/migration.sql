-- CreateTable
CREATE TABLE "SupplierCatalogApplication" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "proposedName" TEXT,
    "proposedSpec" TEXT,
    "proposedCategory" TEXT,
    "proposedGroup" TEXT,
    "proposedUnit" TEXT,
    "quotedPrice" DECIMAL(12,2),
    "deliveryPeriod" TEXT,
    "region" TEXT,
    "minOrder" TEXT,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
    "freightIncluded" BOOLEAN NOT NULL DEFAULT false,
    "counterPrice" DECIMAL(12,2),
    "counterNote" TEXT,
    "qualificationNote" TEXT,
    "attachmentFileAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "reviewerNote" TEXT,
    "approvedReferencePrice" DECIMAL(12,2),
    "approvedPriceMin" DECIMAL(12,2),
    "approvedPriceMax" DECIMAL(12,2),
    "approvedValidUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCatalogApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSupplier" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quotedPrice" DECIMAL(12,2) NOT NULL,
    "deliveryPeriod" TEXT,
    "region" TEXT,
    "minOrder" TEXT,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
    "freightIncluded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCatalogApplication_supplierId_status_idx" ON "SupplierCatalogApplication"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierCatalogApplication_status_type_idx" ON "SupplierCatalogApplication"("status", "type");

-- CreateIndex
CREATE INDEX "SupplierCatalogApplication_catalogItemId_idx" ON "SupplierCatalogApplication"("catalogItemId");

-- CreateIndex
CREATE INDEX "SupplierCatalogApplication_supplierId_catalogItemId_status_idx" ON "SupplierCatalogApplication"("supplierId", "catalogItemId", "status");

-- CreateIndex
CREATE INDEX "CatalogSupplier_catalogItemId_status_idx" ON "CatalogSupplier"("catalogItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSupplier_catalogItemId_supplierId_key" ON "CatalogSupplier"("catalogItemId", "supplierId");

-- AddForeignKey
ALTER TABLE "SupplierCatalogApplication" ADD CONSTRAINT "SupplierCatalogApplication_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCatalogApplication" ADD CONSTRAINT "SupplierCatalogApplication_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSupplier" ADD CONSTRAINT "CatalogSupplier_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSupplier" ADD CONSTRAINT "CatalogSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
