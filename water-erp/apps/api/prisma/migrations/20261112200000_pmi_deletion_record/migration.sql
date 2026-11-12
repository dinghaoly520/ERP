-- 删除留痕（spec 2026-11-12 §5）：独立快照表，无外键；写入仅在 deletePermanently 事务内。
-- 本地库存在迁移漂移（migrate dev 要求 reset），走手写 DDL + db execute + resolve --applied 链。
CREATE TABLE "ProjectDeletionRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectCode" TEXT,
    "requesterName" TEXT NOT NULL,
    "requesterDepartment" TEXT NOT NULL,
    "procurementMethod" TEXT NOT NULL,
    "budgetAmount" DECIMAL(14,2),
    "companyId" TEXT,
    "companyName" TEXT,
    "createdById" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "terminatedStage" TEXT,
    "terminatedByName" TEXT,
    "terminatedRoundNo" INTEGER,
    "recycledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByName" TEXT NOT NULL,

    CONSTRAINT "ProjectDeletionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectDeletionRecord_companyId_deletedAt_idx" ON "ProjectDeletionRecord"("companyId", "deletedAt");
