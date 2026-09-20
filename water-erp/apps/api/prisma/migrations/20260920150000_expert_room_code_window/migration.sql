-- 评标室口令 + 评标窗口隔离（2026-09-20 spec）：BidProject 口令两列 + BidExpert 校验三列
ALTER TABLE "BidProject" ADD COLUMN "roomCode" TEXT,
ADD COLUMN "roomCodeAt" TIMESTAMP(3);

ALTER TABLE "BidExpert" ADD COLUMN "roomVerifiedAt" TIMESTAMP(3),
ADD COLUMN "roomAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "roomLockedUntil" TIMESTAMP(3);
