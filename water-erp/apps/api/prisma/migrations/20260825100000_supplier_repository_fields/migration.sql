-- CTS-EBS01 A-213/216 投标人信息资源库字段（定点迁移：存量漂移不走 migrate dev）
-- A-213 奖惩：SupplierPerformance 复用为业绩/奖励/惩戒三类记录
ALTER TABLE "SupplierPerformance" ADD COLUMN "recordType" TEXT NOT NULL DEFAULT 'performance';
ALTER TABLE "SupplierPerformance" ADD COLUMN "recordNote" TEXT;
ALTER TABLE "SupplierPerformance" ADD COLUMN "effectiveDate" TIMESTAMP(3);
-- A-216 职业资格人员：联系人加人员类别与证书
ALTER TABLE "SupplierContact" ADD COLUMN "personnelType" TEXT;
ALTER TABLE "SupplierContact" ADD COLUMN "certTitle" TEXT;
