-- 开标主持人指派（R1 硬分流）：BidProject 加 assignedHostUserId/assignedAt/assignedByUserId
-- 手写 SQL（非 prisma migrate diff 生成），避免 diff 试图重生成 OperationLog 分区表 DDL

ALTER TABLE "BidProject" ADD COLUMN "assignedHostUserId" TEXT;
ALTER TABLE "BidProject" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "BidProject" ADD COLUMN "assignedByUserId" TEXT;

ALTER TABLE "BidProject" ADD CONSTRAINT "BidProject_assignedHostUserId_fkey"
  FOREIGN KEY ("assignedHostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- :3007 listProjects 按 assignedHostUserId 过滤，建索引避免全表扫描
CREATE INDEX "BidProject_assignedHostUserId_idx" ON "BidProject"("assignedHostUserId");
