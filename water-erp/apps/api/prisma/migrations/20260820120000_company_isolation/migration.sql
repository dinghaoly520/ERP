-- 公司主数据 + 数据隔离归属字段（2026-08-20 公司级数据隔离 P1）
-- 定点迁移：prisma db execute --url $DIRECT_URL --file 本文件 → migrate resolve --applied

-- 1. 公司主数据表
CREATE TABLE "companies" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "shortName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "companies_name_key" ON "companies" ("name");

-- 2. 种子三家公司（固定可读 id，便于回填与测试引用）
INSERT INTO "companies" ("id", "name", "shortName") VALUES
    ('co-swhi-sjy', '四川水发勘测设计研究有限公司', '设计院'),
    ('co-swhi-js',  '四川水发建设有限公司',         '建设'),
    ('co-swhi-tz',  '四川水发投资有限公司',         '投资');

-- 3. User 挂公司
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_companyId_idx" ON "User" ("companyId");

-- 4. 五张业务表加归属（隔离依据 + 展示快照）
ALTER TABLE "ProjectManagementItem" ADD COLUMN "companyId"   TEXT,
                                     ADD COLUMN "companyName" TEXT;
ALTER TABLE "ProjectManagementItem" ADD CONSTRAINT "PMI_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PMI_companyId_idx" ON "ProjectManagementItem" ("companyId");

ALTER TABLE "ProcurementProject" ADD COLUMN "companyId"   TEXT,
                                  ADD COLUMN "companyName" TEXT;
ALTER TABLE "ProcurementProject" ADD CONSTRAINT "PP_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PP_companyId_idx" ON "ProcurementProject" ("companyId");

ALTER TABLE "ProcurementRound" ADD COLUMN "companyId"   TEXT,
                                ADD COLUMN "companyName" TEXT;
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "PR_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PR_companyId_idx" ON "ProcurementRound" ("companyId");

ALTER TABLE "BidProject" ADD COLUMN "companyId"   TEXT,
                          ADD COLUMN "companyName" TEXT;
ALTER TABLE "BidProject" ADD CONSTRAINT "BP_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "BP_companyId_idx" ON "BidProject" ("companyId");

ALTER TABLE "Announcement" ADD COLUMN "companyId"   TEXT,
                            ADD COLUMN "companyName" TEXT;
ALTER TABLE "Announcement" ADD CONSTRAINT "ANN_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ANN_companyId_idx" ON "Announcement" ("companyId");

-- 5. User 回填：按公司文本精确挂靠（幂等：仅填空值）
UPDATE "User" SET "companyId" = 'co-swhi-sjy'
WHERE "companyId" IS NULL AND "company" = '四川水发勘测设计研究有限公司';
UPDATE "User" SET "companyId" = 'co-swhi-js'
WHERE "companyId" IS NULL AND "company" = '四川水发建设有限公司';
UPDATE "User" SET "companyId" = 'co-swhi-tz'
WHERE "companyId" IS NULL AND "company" = '四川水发投资有限公司';

-- 6. 清除无主存量数据（拍板决策 2：无归属数据全部清除，由业务重新构建）
--    PMI 无创建人 → 连带阶段/附件级联（stages/attachments 外键 onDelete Cascade）
DELETE FROM "ProjectManagementItem" WHERE "createdById" IS NULL;
--    台账无创建人（关联的 BidProject 若有主仍保留，仅清台账行本身）
DELETE FROM "ProcurementProject" WHERE "creatorId" IS NULL;
--    轮次无创建人
DELETE FROM "ProcurementRound" WHERE "createdById" IS NULL;
--    公告无作者（公开门户公示属存量正常数据，若无作者视为种子残留一并清除）
DELETE FROM "Announcement" WHERE "authorId" IS NULL;

-- 7. 业务数据回填：按创建人公司写归属（幂等）
UPDATE "ProjectManagementItem" t
SET "companyId" = u."companyId", "companyName" = u."company"
FROM "User" u
WHERE t."createdById" = u."id" AND u."companyId" IS NOT NULL AND t."companyId" IS NULL;

UPDATE "ProcurementProject" t
SET "companyId" = u."companyId", "companyName" = u."company"
FROM "User" u
WHERE t."creatorId" = u."id" AND u."companyId" IS NOT NULL AND t."companyId" IS NULL;

UPDATE "ProcurementRound" t
SET "companyId" = u."companyId", "companyName" = u."company"
FROM "User" u
WHERE t."createdById" = u."id" AND u."companyId" IS NOT NULL AND t."companyId" IS NULL;

UPDATE "Announcement" t
SET "companyId" = u."companyId", "companyName" = u."company"
FROM "User" u
WHERE t."authorId" = u."id" AND u."companyId" IS NOT NULL AND t."companyId" IS NULL;

-- BidProject 无创建人字段：经关联的 ProcurementProject（bidProjectId）推导
UPDATE "BidProject" b
SET "companyId" = pp."companyId", "companyName" = pp."companyName"
FROM "ProcurementProject" pp
WHERE pp."bidProjectId" = b."id" AND pp."companyId" IS NOT NULL AND b."companyId" IS NULL;
