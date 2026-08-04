-- AlterTable: BidExpert 新增 RSVP token（免登录确认链接，15分钟有效期）
ALTER TABLE "BidExpert" ADD COLUMN IF NOT EXISTS "rsvpToken" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN IF NOT EXISTS "rsvpExpiresAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN IF NOT EXISTS "rsvpRespondedAt" TIMESTAMP(3);

-- CreateIndex: rsvpToken 唯一索引（用于免登录查找）
CREATE UNIQUE INDEX IF NOT EXISTS "BidExpert_rsvpToken_key" ON "BidExpert"("rsvpToken");
