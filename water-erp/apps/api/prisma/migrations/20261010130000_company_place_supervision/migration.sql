-- 开标地点 / 监督信息 条目（2026-10-10 多条目版，与采购人条目同款模式）：
-- 公司信息管理维护多条、单默认——编写时按钮选择，默认条目用于进入页预填

-- ── 开标地点条目 ──
CREATE TABLE "CompanyPlace" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPlace_pkey" PRIMARY KEY ("id")
);

-- 存量回填：已有 bidOpeningAddress 的公司生成一条默认地点条目（名称取「默认开标地点」）
INSERT INTO "CompanyPlace" ("id", "companyId", "label", "address", "isDefault", "createdAt", "updatedAt")
SELECT 'cpl-' || md5(c."id"), c."id", '默认开标地点', c."bidOpeningAddress", true, NOW(), NOW()
FROM "companies" c
WHERE c."bidOpeningAddress" IS NOT NULL AND c."bidOpeningAddress" <> '';

CREATE INDEX "CompanyPlace_companyId_idx" ON "CompanyPlace"("companyId");
ALTER TABLE "CompanyPlace" ADD CONSTRAINT "CompanyPlace_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 监督信息方案条目 ──
CREATE TABLE "CompanySupervision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "department" TEXT,
    "address" TEXT,
    "contact" TEXT,
    "phone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySupervision_pkey" PRIMARY KEY ("id")
);

-- 存量回填：任一监督字段有维护值的公司生成一条默认方案条目
INSERT INTO "CompanySupervision" ("id", "companyId", "label", "department", "address", "contact", "phone", "isDefault", "createdAt", "updatedAt")
SELECT 'csu-' || md5(c."id"), c."id", '默认监督方案', c."supervisionDept", c."supervisionAddress", c."supervisionContact", c."supervisionPhone", true, NOW(), NOW()
FROM "companies" c
WHERE COALESCE(c."supervisionDept", c."supervisionAddress", c."supervisionContact", c."supervisionPhone") IS NOT NULL;

CREATE INDEX "CompanySupervision_companyId_idx" ON "CompanySupervision"("companyId");
ALTER TABLE "CompanySupervision" ADD CONSTRAINT "CompanySupervision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
