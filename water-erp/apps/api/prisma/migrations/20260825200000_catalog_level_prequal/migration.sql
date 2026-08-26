-- B2（GB/T 43711 4.1.1.3/4.1.3.2）：目录分级 + B3（7.2.3）：资格预审登记制
-- AlterEnum
ALTER TYPE "AnnouncementType" ADD VALUE 'PREQUAL_NOTICE';

-- AlterTable（B2）
ALTER TABLE "CatalogCategory" ADD COLUMN "centralizedLevel" TEXT DEFAULT 'centralized';
ALTER TABLE "CatalogCategory" ADD COLUMN "centralizedThreshold" DECIMAL(14,2);

-- AlterTable（B3 资格后审登记字段）
ALTER TABLE "BidProject" ADD COLUMN "qualificationReviewResult" TEXT;

-- CreateTable（B3 资格预审）
CREATE TABLE "Prequalification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "announcementId" TEXT,
    "projectId" TEXT,
    "catalogCategoryId" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'single',
    "method" TEXT NOT NULL DEFAULT 'qualified',
    "limitedCount" INTEGER,
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "result" JSONB,
    "companyId" TEXT,
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prequalification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrequalApplication" (
    "id" TEXT NOT NULL,
    "prequalId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrequalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prequalification_catalogCategoryId_idx" ON "Prequalification"("catalogCategoryId");
CREATE INDEX "Prequalification_status_idx" ON "Prequalification"("status");
CREATE UNIQUE INDEX "PrequalApplication_prequalId_supplierId_key" ON "PrequalApplication"("prequalId", "supplierId");
CREATE INDEX "PrequalApplication_supplierId_idx" ON "PrequalApplication"("supplierId");

-- AddForeignKey
ALTER TABLE "PrequalApplication" ADD CONSTRAINT "PrequalApplication_prequalId_fkey" FOREIGN KEY ("prequalId") REFERENCES "Prequalification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
