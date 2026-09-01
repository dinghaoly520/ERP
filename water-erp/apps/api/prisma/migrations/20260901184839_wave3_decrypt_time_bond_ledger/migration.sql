-- P1 波3 Task1：A-111 解密时间列 + A-102 保证金到账台账
ALTER TABLE "BidSupplier" ADD COLUMN "decryptedAt" TIMESTAMP(3);
CREATE TABLE "BidBondLedger" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "account" TEXT NOT NULL,
    "payMethod" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidBondLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidBondLedger_projectId_supplierName_key" ON "BidBondLedger"("projectId", "supplierName");
CREATE INDEX "BidBondLedger_projectId_arrivedAt_idx" ON "BidBondLedger"("projectId", "arrivedAt");
ALTER TABLE "BidBondLedger" ADD CONSTRAINT "BidBondLedger_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
