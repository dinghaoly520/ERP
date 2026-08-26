-- C6（GB/T 43711 4.1.4/4.2.2）：供应商异议/投诉工单（登记制）
-- CreateTable
CREATE TABLE "SupplierObjection" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT,
    "projectId" TEXT,
    "projectCode" TEXT,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'result',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "answeredBy" TEXT,
    "answeredByName" TEXT,
    "answeredAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierObjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierObjection_supplierId_idx" ON "SupplierObjection"("supplierId");
CREATE INDEX "SupplierObjection_status_idx" ON "SupplierObjection"("status");
