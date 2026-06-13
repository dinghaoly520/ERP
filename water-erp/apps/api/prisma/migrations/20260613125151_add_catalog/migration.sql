-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "referencePrice" DECIMAL(12,2) NOT NULL,
    "priceMin" DECIMAL(12,2) NOT NULL,
    "priceMax" DECIMAL(12,2) NOT NULL,
    "lastDealPrice" DECIMAL(12,2) NOT NULL,
    "averagePrice" DECIMAL(12,2) NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplierType" TEXT NOT NULL,
    "priceSource" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
    "freightIncluded" BOOLEAN NOT NULL DEFAULT false,
    "changeRate" DECIMAL(5,2) NOT NULL,
    "minOrder" TEXT NOT NULL,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT '有效',
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_code_key" ON "CatalogItem"("code");

-- CreateIndex
CREATE INDEX "CatalogItem_category_idx" ON "CatalogItem"("category");

-- CreateIndex
CREATE INDEX "CatalogItem_group_idx" ON "CatalogItem"("group");

-- CreateIndex
CREATE INDEX "CatalogItem_status_idx" ON "CatalogItem"("status");
