-- CTS-EBS01 A-39/40 标段（包）标识（定点迁移：存量漂移不走 migrate dev）
ALTER TABLE "BidProject" ADD COLUMN "sectionNo" TEXT;
ALTER TABLE "BidProject" ADD COLUMN "sectionName" TEXT;
