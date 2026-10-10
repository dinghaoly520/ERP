-- 采购人条目（2026-10-10 多人版）：公司信息管理维护多条、单默认，编写时按钮选择
CREATE TABLE "CompanyPurchaser" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPurchaser_pkey" PRIMARY KEY ("id")
);

-- 存量回填：已有单采购人字段（purchaserContact 等）的公司生成一条默认条目，保证连续性
INSERT INTO "CompanyPurchaser" ("id", "companyId", "name", "phone", "email", "isDefault", "createdAt", "updatedAt")
SELECT 'cp-' || md5(c."id" || c."purchaserContact"), c."id", c."purchaserContact", c."purchaserPhone", c."purchaserEmail", true, NOW(), NOW()
FROM "companies" c
WHERE c."purchaserContact" IS NOT NULL AND c."purchaserContact" <> '';

-- CreateIndex
CREATE INDEX "CompanyPurchaser_companyId_idx" ON "CompanyPurchaser"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyPurchaser" ADD CONSTRAINT "CompanyPurchaser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
