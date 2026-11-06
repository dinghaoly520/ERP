-- 评审 I-1 修复（2026-11-06）：同库同 sha256 活动行唯一——并发重复上传的 TOCTOU 兜底
--（findFirst→create 窗口含 118MB MinIO 上传，秒级宽；jobId=fileId 双保险保护不到「两行两个 fileId」场景）
-- partial：FAILED 不占位（可被复用重置）；sha256 NULL（存量行）天然不冲突。
-- 刻意偏离注记：Prisma schema 语法不支持 partial unique index，本索引不入 schema.prisma——
-- 与 OperationLog 单列 PK 同族（见 memory main-db-migration-drift），diff 重生成时勿据此回滚。
CREATE UNIQUE INDEX "KnowledgeFile_kb_sha_active_uniq"
  ON "KnowledgeFile"("knowledgeBaseId", "sha256")
  WHERE "status" IN ('PARSING', 'READY');
