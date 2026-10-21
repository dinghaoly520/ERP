-- 供应商自答快照（2026-10-21 用户口径：代变更不覆盖原回执）：
-- supplierRespondedAt=供应商链接自答时刻 / supplierStatus=其原始选择——
-- 与 respondedAt（当前生效状态的最后动作时刻）并列，工作人员代变更不触碰这两列
ALTER TABLE "InvitationRsvp" ADD COLUMN "supplierRespondedAt" TIMESTAMP(3);
ALTER TABLE "InvitationRsvp" ADD COLUMN "supplierStatus" TEXT;
