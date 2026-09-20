-- 评标专家身份核验 P1（spec 2026-09-18-expert-identity-verification §5）
-- phoneVerified 链路已于 4d224c65 删除，本迁移清列；identity 六列预置供 host 态（P3）使用
ALTER TABLE "BidExpert" DROP COLUMN "phoneVerified";
ALTER TABLE "BidExpert" ADD COLUMN "identityVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BidExpert" ADD COLUMN "identityVerifiedAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN "identityVerifiedBy" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "identityVerifiedByName" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "identityDocType" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "identityNote" TEXT;
