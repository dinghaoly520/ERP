-- CreateTable: 全局键值配置（澄清说明文案等平台级文本）
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
