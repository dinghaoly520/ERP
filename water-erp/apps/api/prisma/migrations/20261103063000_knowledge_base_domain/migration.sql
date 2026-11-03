-- 水叮当知识库与采购文件审查知识库域隔离（2026-11-03 用户裁定）：
-- 存量行默认 tender_review（审查域）；水叮当新建库写 assistant
ALTER TABLE "KnowledgeBase" ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'tender_review';
