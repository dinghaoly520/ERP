/*
  对账迁移（2026-09-30 终检「迁移」轮）：prisma migrate diff 检出三处 schema↔dev 库漂移，
  本笔统一收口——fresh 环境 migrate deploy 与 dev 库从此同构：
  ① Notification.readAt 精度：DB 为 timestamp（秒级截断，markAsRead 的毫秒被吞）→ TIMESTAMP(3)
  ② Supplier.reviewStage 索引：dev 库已有（db push 产物）但迁移链缺失——fresh 环境不会建；
     schema 已补声明，此处 IF NOT EXISTS 幂等补建
  ③ SupplierPenalty.supplierId 外键：schema 声明 onDelete: Cascade 但 DB 无约束
     （已核 0 孤儿行，补建安全）
*/
-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "readAt" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex（幂等：dev 库已存在）
CREATE INDEX IF NOT EXISTS "Supplier_reviewStage_idx" ON "Supplier"("reviewStage");

-- AddForeignKey
ALTER TABLE "SupplierPenalty" ADD CONSTRAINT "SupplierPenalty_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
