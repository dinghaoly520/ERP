-- tender-review 知识库 RAG：恢复 "DocumentChunk".embedding 列（pgvector）
-- 前置：postgres 镜像已换为 pgvector/pgvector:pg16（docker-compose.yml）
-- 配套：schema.prisma DocumentChunk.embedding Unsupported("vector")?；
--       .env PGVECTOR_ENABLED=true（VectorInitService 启动时兜底建扩展+HNSW 索引）

CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
