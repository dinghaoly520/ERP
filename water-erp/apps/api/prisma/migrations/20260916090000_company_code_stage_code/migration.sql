-- 公司编码（项目编号前缀段）+ 阶段唯一编号
-- 编码拍板（2026-09-16）：设计院=SWHI、集团=SWDG、建设=SFJS、投资=SFTZ

ALTER TABLE "companies" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");

UPDATE "companies" SET "code" = 'SWHI' WHERE "name" = '四川水发勘测设计研究有限公司';
UPDATE "companies" SET "code" = 'SWDG'  WHERE "name" IN ('四川水发集团', '四川省水利发展集团有限公司');
UPDATE "companies" SET "code" = 'SFJS' WHERE "name" = '四川水发建设有限公司';
UPDATE "companies" SET "code" = 'SFTZ' WHERE "name" = '四川水发投资有限公司';

ALTER TABLE "ProjectManagementStage" ADD COLUMN "stageCode" TEXT;
CREATE UNIQUE INDEX "ProjectManagementStage_stageCode_key" ON "ProjectManagementStage"("stageCode");

-- 存量项目编号补公司前缀：旧两段式 TP-2026090713 → SWHI-TP-2026090713
-- 仅匹配旧格式（两字母-十位日期序号），重放安全（幂等）
UPDATE "ProjectManagementItem" pmi
SET "projectCode" = c."code" || '-' || pmi."projectCode"
FROM "companies" c
WHERE pmi."companyId" = c."id"
  AND c."code" IS NOT NULL
  AND pmi."projectCode" ~ '^[A-Z]{2}-[0-9]{10}$';

-- 存量阶段编号回填：<项目编号>-<阶段缩写>-R<轮次>
UPDATE "ProjectManagementStage" s
SET "stageCode" = pmi."projectCode" || '-' ||
  CASE s."stageKey"
    WHEN 'PROCUREMENT_DEMAND'   THEN 'XQ'
    WHEN 'INITIATION'           THEN 'LJ'
    WHEN 'TENDER_DOCUMENT'      THEN 'WJ'
    WHEN 'SUPPLIER_INVITATION'  THEN 'YQ'
    WHEN 'PUBLIC_ANNOUNCEMENT'  THEN 'GG'
    WHEN 'EXPERT_SELECTION'     THEN 'ZJ'
    WHEN 'BID_EVALUATION'       THEN 'PB'
    WHEN 'AWARD_DECISION'       THEN 'DB'
    WHEN 'CONTRACT'             THEN 'HT'
    ELSE 'ST'
  END || '-R' || s."round"
FROM "ProjectManagementItem" pmi
WHERE s."projectManagementItemId" = pmi."id"
  AND s."stageCode" IS NULL
  AND pmi."projectCode" IS NOT NULL;
