-- 敏感字段国密加密（等保三级+密评）：盲索引列 + 明文揭示审计表。纯增量 DDL。
-- 注：迁移链与 schema 在 User.companyId 索引上的历史漂移（20260820120000 建、schema 未声明、
-- dev 库实无）非本次引入，不在本迁移处理，避免破坏任一环境重放。

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneIdx" TEXT;

-- CreateIndex
CREATE INDEX "User_phoneIdx_idx" ON "User"("phoneIdx");

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "legalPersonIdCardIdx" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_legalPersonIdCardIdx_idx" ON "Supplier"("legalPersonIdCardIdx");

-- AlterTable
ALTER TABLE "SupplierContact" ADD COLUMN     "idCardIdx" TEXT;

-- CreateIndex
CREATE INDEX "SupplierContact_idCardIdx_idx" ON "SupplierContact"("idCardIdx");

-- CreateTable
CREATE TABLE "SensitiveAccessLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT,
    "entity" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SensitiveAccessLog_actorUserId_createdAt_idx" ON "SensitiveAccessLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SensitiveAccessLog_entity_targetId_idx" ON "SensitiveAccessLog"("entity", "targetId");
