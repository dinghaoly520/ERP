-- 知识库按用户隔离 + 共享选项（见 docs/superpowers/specs/2026-07-28-kb-per-user-and-sharing-design.md）
-- 前置无；本迁移为 KnowledgeBase 加 ownerId + isShared，并按用户决策"清空重来"删现有 KB。

-- AlterTable
ALTER TABLE "KnowledgeBase" ADD COLUMN "ownerId" text;
ALTER TABLE "KnowledgeBase" ADD COLUMN "isShared" boolean NOT NULL DEFAULT false;

-- 割接：清空重来（用户已确认，不可逆）
--   级联：KnowledgeFile/ComplianceRule 随 KnowledgeBase onDelete:Cascade 一并清除；
--   ReviewTask.knowledgeBaseId 为可空外键（Prisma 默认 ON DELETE SET NULL）→ 审查历史保留、kbId 置空。
DELETE FROM "KnowledgeBase";
-- DocumentChunk 与 KnowledgeFile 之间无 FK（向量表由 VectorSearchService 裸 SQL 管理，不参与级联），
-- 需显式清空，否则留下指向已删 fileId 的孤儿向量。
DELETE FROM "DocumentChunk";

-- ownerId 设为 NOT NULL（DELETE 后表为空，可安全 SET NOT NULL；此后新建必填，由应用层注入创建者 id）
ALTER TABLE "KnowledgeBase" ALTER COLUMN "ownerId" SET NOT NULL;
