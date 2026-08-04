-- 漂移对齐：补齐「标记为 applied 但 SQL 未执行」+ 从未生成迁移的列/表。
-- 注意：刻意排除 (1) DocumentChunk.embedding vector 列（postgres 无 pgvector 扩展，tender-review RAG 有 PGVECTOR_ENABLED 运行时兜底）；
--       (2) OperationLog 主键变更（按月分区表 PK 必须含 createdAt，禁止 diff 改回单列 PK，见 CLAUDE.md）。

-- DropIndex
DROP INDEX IF EXISTS "pricealert_rule_item_uniq";
DROP INDEX IF EXISTS "SupplierInvitation_usedById_idx";

-- AlterTable: 开标会话补齐字段（含 handoverAssetId 之外的会议控制字段）
ALTER TABLE "BidOpeningSession"
  ADD COLUMN IF NOT EXISTS "activeHostId" TEXT,
  ADD COLUMN IF NOT EXISTS "activeHostName" TEXT,
  ADD COLUMN IF NOT EXISTS "disputeTimeoutMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "disputedSince" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "totalPausedMs" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BidScoreRecord" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: 知识库按用户隔离 + 共享（kb_owner_and_shared 标记 applied 但 SQL 未跑）
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "isShared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
UPDATE "KnowledgeBase" SET "ownerId" = '' WHERE "ownerId" IS NULL;
ALTER TABLE "KnowledgeBase" ALTER COLUMN "ownerId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ProjectManagementItem" DROP COLUMN IF EXISTS "fileAcquisitionTime";

-- AlterTable
ALTER TABLE "SupplierBidSubmission" ADD COLUMN IF NOT EXISTS "serverSubmittedAt" TIMESTAMP(3);

-- CreateTable: 全局键值配置（system_config 标记 applied 但 SQL 未跑）
CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
