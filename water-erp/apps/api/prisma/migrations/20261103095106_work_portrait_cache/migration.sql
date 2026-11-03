-- 工作画像缓存（2026-11-03）：每周一 12:00 定时批量生成的唯一数据源
CREATE TABLE "WorkPortraitCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portrait" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkPortraitCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkPortraitCache_userId_key" ON "WorkPortraitCache"("userId");
CREATE INDEX "WorkPortraitCache_userId_idx" ON "WorkPortraitCache"("userId");
