-- Supplier 注册 2.0 扩展：基本信息新字段 + 联系人性别 + 资质附加材料 + 银行账户 + 主体业绩
ALTER TABLE "Supplier"
  ADD COLUMN "companyEmail" TEXT,
  ADD COLUMN "companyWebsite" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "detailedAddress" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "legalPersonPhone" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "organizationCode" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "registeredCapital" TEXT;

ALTER TABLE "SupplierContact" ADD COLUMN "gender" TEXT;

ALTER TABLE "SupplierQualification" ADD COLUMN "attachments" JSONB;

CREATE TABLE "SupplierBankAccount" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankBranch" TEXT,
    "accountNo" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierPerformance" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "clientName" TEXT,
    "contractAmount" TEXT,
    "signDate" TIMESTAMP(3),
    "description" TEXT,
    "proofFiles" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierPerformance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierBankAccount_supplierId_idx" ON "SupplierBankAccount"("supplierId");
CREATE INDEX "SupplierPerformance_supplierId_idx" ON "SupplierPerformance"("supplierId");

ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPerformance" ADD CONSTRAINT "SupplierPerformance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
