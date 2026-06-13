-- CreateTable
CREATE TABLE "BudgetList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "procurementProjectId" TEXT,
    "totalAmount" DECIMAL(14,2),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" TEXT NOT NULL,
    "budgetListId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL,
    "referencePrice" DECIMAL(12,2) NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetList_procurementProjectId_key" ON "BudgetList"("procurementProjectId");

-- CreateIndex
CREATE INDEX "BudgetList_userId_idx" ON "BudgetList"("userId");

-- CreateIndex
CREATE INDEX "BudgetList_status_idx" ON "BudgetList"("status");

-- CreateIndex
CREATE INDEX "BudgetItem_budgetListId_idx" ON "BudgetItem"("budgetListId");

-- CreateIndex
CREATE INDEX "BudgetItem_catalogItemId_idx" ON "BudgetItem"("catalogItemId");

-- AddForeignKey
ALTER TABLE "BudgetList" ADD CONSTRAINT "BudgetList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetList" ADD CONSTRAINT "BudgetList_procurementProjectId_fkey" FOREIGN KEY ("procurementProjectId") REFERENCES "ProcurementProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_budgetListId_fkey" FOREIGN KEY ("budgetListId") REFERENCES "BudgetList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
