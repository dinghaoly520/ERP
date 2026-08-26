-- B4（GB/T 43711 附录 D）：框架协议采购两阶段
-- AlterTable（二阶段项目回链）
ALTER TABLE "BidProject" ADD COLUMN "frameworkAgreementId" TEXT;

-- CreateTable（一阶段协议）
CREATE TABLE "FrameworkAgreement" (
    "id" TEXT NOT NULL,
    "faCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entryMode" TEXT NOT NULL DEFAULT 'closed',
    "variant" TEXT NOT NULL DEFAULT 'supplier_price',
    "catalogCategoryId" INTEGER,
    "projectManagementItemId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "priceRule" JSONB,
    "quotaRule" JSONB,
    "secondStageRule" TEXT,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "eliminationCheck" JSONB,
    "changeLog" JSONB,
    "companyId" TEXT,
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable（入围供应商）
CREATE TABLE "FaEntry" (
    "id" TEXT NOT NULL,
    "faId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "shareRatio" DECIMAL(5,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "entryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "FaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FrameworkAgreement_faCode_key" ON "FrameworkAgreement"("faCode");
CREATE INDEX "FrameworkAgreement_status_idx" ON "FrameworkAgreement"("status");
CREATE INDEX "FrameworkAgreement_catalogCategoryId_idx" ON "FrameworkAgreement"("catalogCategoryId");
CREATE INDEX "FaEntry_faId_idx" ON "FaEntry"("faId");
CREATE INDEX "FaEntry_supplierId_idx" ON "FaEntry"("supplierId");

-- AddForeignKey
ALTER TABLE "FaEntry" ADD CONSTRAINT "FaEntry_faId_fkey" FOREIGN KEY ("faId") REFERENCES "FrameworkAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
