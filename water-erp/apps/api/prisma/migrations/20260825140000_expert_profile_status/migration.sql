-- CTS-EBS01 A-218/222 专家库状态机与审核留痕（定点迁移：存量漂移不走 migrate dev）
-- 存量专家视同已入库（entryStatus=ACTIVE）；entryStatus=RETIRED 与既有 retiredAt 语义对齐
ALTER TABLE "ExpertProfile" ADD COLUMN "entryStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "ExpertProfile" ADD COLUMN "statusNote" TEXT;
ALTER TABLE "ExpertProfile" ADD COLUMN "verifiedById" TEXT;
ALTER TABLE "ExpertProfile" ADD COLUMN "verifiedAt" TIMESTAMP(3);
UPDATE "ExpertProfile" SET "entryStatus" = 'RETIRED' WHERE "retiredAt" IS NOT NULL;
