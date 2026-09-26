-- 通知查阅时间（2026-09-26 五段状态视图：已阅段展示"什么时候进行的查阅"）
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP;
