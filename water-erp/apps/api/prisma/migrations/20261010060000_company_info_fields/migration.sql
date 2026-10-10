-- 公司信息管理（2026-10-10）：开标/监督/采购人维护值，采购文件与公告编写按登录人公司预填
ALTER TABLE "companies" ADD COLUMN "bidOpeningAddress" TEXT;
ALTER TABLE "companies" ADD COLUMN "supervisionDept" TEXT;
ALTER TABLE "companies" ADD COLUMN "supervisionAddress" TEXT;
ALTER TABLE "companies" ADD COLUMN "supervisionContact" TEXT;
ALTER TABLE "companies" ADD COLUMN "supervisionPhone" TEXT;
ALTER TABLE "companies" ADD COLUMN "purchaserAddress" TEXT;
ALTER TABLE "companies" ADD COLUMN "purchaserContact" TEXT;
ALTER TABLE "companies" ADD COLUMN "purchaserPhone" TEXT;
ALTER TABLE "companies" ADD COLUMN "purchaserEmail" TEXT;
