-- 知识库解析异步化（2026-11-06）：KnowledgeFile 增状态/进度/错误/降级标志/去重键六字段
-- 金仓上 migrate dev --create-only 的 DevDiagnostic 失败（gen_random_uuid 不存在），
-- 本迁移手写，增量段取自 `migrate diff --from-schema-datasource` 的 KnowledgeFile 部分
--（刻意偏离项——OperationLog 主键/索引命名/DocumentChunk embedding——不纳入，见 main-db-migration-drift）

-- AlterTable
ALTER TABLE "KnowledgeFile" ADD COLUMN     "error" TEXT,
ADD COLUMN     "indexed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "processedPages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PARSING',
ADD COLUMN     "totalPages" INTEGER;

-- CreateIndex
CREATE INDEX "KnowledgeFile_knowledgeBaseId_sha256_idx" ON "KnowledgeFile"("knowledgeBaseId", "sha256");

-- Backfill：存量行均已解析完成，回填 READY（indexed 无法跨向量库 join 推导，统一 true，reindex 可纠偏）
UPDATE "KnowledgeFile" SET "status" = 'READY', "indexed" = true;
