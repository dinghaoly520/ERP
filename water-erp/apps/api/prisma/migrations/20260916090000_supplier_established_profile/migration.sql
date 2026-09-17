-- 2026-09-16 供应商注册信息扩展：企业注册成立日期、企业简介
ALTER TABLE "Supplier" ADD COLUMN "establishedDate" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "companyProfile" TEXT;
