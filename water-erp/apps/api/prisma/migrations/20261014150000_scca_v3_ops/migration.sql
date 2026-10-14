-- 阶段2.5 T0：BidFileBackup 版本维度 + Outbox 消费退避列
-- 自然键 [projectId,supplierId,fileRole,revision] 等价 submissionId+revision+role（supplierId+projectId↔submission 一一对应，v2 存量行 revision=0 零回填共存）
ALTER TABLE "BidFileBackup" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
DROP INDEX "BidFileBackup_supplierId_projectId_fileRole_key";
CREATE UNIQUE INDEX "BidFileBackup_projectId_supplierId_fileRole_revision_key" ON "BidFileBackup"("projectId", "supplierId", "fileRole", "revision");
ALTER TABLE "Outbox" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Outbox" ADD COLUMN "lastError" TEXT;
