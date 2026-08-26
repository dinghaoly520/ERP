-- C2/C3/C4（GB/T 43711 7.5.4 合同订立 / 7.6 履行验收 / 7.5.4.4 保证金退还）
-- AlterEnum
ALTER TYPE "AnnouncementType" ADD VALUE 'CONTRACT_NOTICE';
ALTER TYPE "AnnouncementType" ADD VALUE 'PERFORMANCE_NOTICE';

-- AlterTable（C4：保证金退还时间）
ALTER TABLE "BidProject" ADD COLUMN "bondReturnedAt" TIMESTAMP(3);

-- AlterTable（C3：履约评价来源）
ALTER TABLE "SupplierEvaluation" ADD COLUMN "evaluationSource" TEXT NOT NULL DEFAULT 'procurement';

-- CreateTable（C2：采购合同）
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractCode" TEXT NOT NULL,
    "projectId" TEXT,
    "projectCode" TEXT NOT NULL,
    "projectManagementItemId" TEXT,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "contractType" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "amount" DECIMAL(15,2),
    "signDeadline" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "keyTerms" JSONB,
    "draftAssetId" TEXT,
    "signedAssetId" TEXT,
    "consistencyResult" JSONB,
    "reviewNote" TEXT,
    "companyId" TEXT,
    "companyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable（C3：合同履行台账）
CREATE TABLE "ContractFulfillment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "doneDate" TIMESTAMP(3),
    "amount" DECIMAL(15,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proofAssetId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractFulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractCode_key" ON "Contract"("contractCode");
CREATE INDEX "Contract_supplierId_idx" ON "Contract"("supplierId");
CREATE INDEX "Contract_status_idx" ON "Contract"("status");
CREATE INDEX "Contract_projectCode_idx" ON "Contract"("projectCode");
CREATE INDEX "ContractFulfillment_contractId_type_idx" ON "ContractFulfillment"("contractId", "type");

-- AddForeignKey
ALTER TABLE "ContractFulfillment" ADD CONSTRAINT "ContractFulfillment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
