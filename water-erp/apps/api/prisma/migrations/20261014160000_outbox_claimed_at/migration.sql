-- 终审 I-2：Outbox DISPATCHING 崩溃残留恢复锚点
ALTER TABLE "Outbox" ADD COLUMN "claimedAt" TIMESTAMP(3);
