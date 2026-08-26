-- C4 阶段合规规则配置化（DB 覆盖层）
-- CreateTable
CREATE TABLE "StageComplianceRule" (
    "id" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "regulationRef" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StageComplianceRule_stageKey_name_key" ON "StageComplianceRule"("stageKey", "name");

-- CreateIndex
CREATE INDEX "StageComplianceRule_stageKey_idx" ON "StageComplianceRule"("stageKey");
