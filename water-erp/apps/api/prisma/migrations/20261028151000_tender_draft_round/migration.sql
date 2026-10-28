-- 2026-10-28 二轮隔离：采购文件草稿按轮隔离（存量行 round=1）
ALTER TABLE "ProjectTenderDraft" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "ProjectTenderDraft_projectId_key";
ALTER TABLE "ProjectTenderDraft" ADD CONSTRAINT "ProjectTenderDraft_projectId_round_key" UNIQUE ("projectId", "round");

ALTER TABLE "ProjectTenderDraftVersion" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "ProjectTenderDraftVersion_projectId_createdAt_idx";
CREATE INDEX "ProjectTenderDraftVersion_projectId_round_createdAt_idx" ON "ProjectTenderDraftVersion"("projectId", "round", "createdAt");
