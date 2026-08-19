-- 供应商注册新增：法定代表人身份证号 + 联系人身份证号（注册必填，存量数据可空）
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "legalPersonIdCard" TEXT;
ALTER TABLE "SupplierContact" ADD COLUMN IF NOT EXISTS "idCard" TEXT;
