-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "categoryId" INTEGER;

-- CreateTable
CREATE TABLE "CatalogCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isLeaf" BOOLEAN NOT NULL DEFAULT false,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAttributeTemplate" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryAttributeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemAttribute" (
    "id" SERIAL NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "templateId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "CatalogItemAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCategory_code_key" ON "CatalogCategory"("code");

-- CreateIndex
CREATE INDEX "CatalogCategory_parentId_idx" ON "CatalogCategory"("parentId");

-- CreateIndex
CREATE INDEX "CatalogCategory_code_idx" ON "CatalogCategory"("code");

-- CreateIndex
CREATE INDEX "CategoryAttributeTemplate_categoryId_idx" ON "CategoryAttributeTemplate"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryAttributeTemplate_categoryId_fieldKey_key" ON "CategoryAttributeTemplate"("categoryId", "fieldKey");

-- CreateIndex
CREATE INDEX "CatalogItemAttribute_catalogItemId_idx" ON "CatalogItemAttribute"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemAttribute_catalogItemId_templateId_key" ON "CatalogItemAttribute"("catalogItemId", "templateId");

-- CreateIndex
CREATE INDEX "CatalogItem_categoryId_idx" ON "CatalogItem"("categoryId");

-- AddForeignKey
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttributeTemplate" ADD CONSTRAINT "CategoryAttributeTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemAttribute" ADD CONSTRAINT "CatalogItemAttribute_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemAttribute" ADD CONSTRAINT "CatalogItemAttribute_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CategoryAttributeTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
