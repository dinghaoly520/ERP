-- AlterTable：采购人地址自公司级 Company.purchaserAddress 迁为条目级（2026-10-21 用户裁定：
-- 采购人卡内与姓名/电话/邮箱同行第四字段，同格式即时保存）
ALTER TABLE "CompanyPurchaser" ADD COLUMN "address" TEXT;

-- DataBackfill：存量公司级地址落到该公司全部采购人条目（tender-write 预填取默认条目，公司列保留作回退）
UPDATE "CompanyPurchaser" p SET "address" = c."purchaserAddress"
FROM companies c
WHERE p."companyId" = c.id AND c."purchaserAddress" IS NOT NULL AND trim(c."purchaserAddress") <> '';
