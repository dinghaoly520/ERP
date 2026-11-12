-- CreateTable
CREATE TABLE "SupplierBidIntent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBidIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBidNoShow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SupplierBidNoShow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierBidIntent_projectId_idx" ON "SupplierBidIntent"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBidIntent_projectId_supplierId_key" ON "SupplierBidIntent"("projectId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierBidNoShow_supplierId_idx" ON "SupplierBidNoShow"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBidNoShow_projectId_supplierId_key" ON "SupplierBidNoShow"("projectId", "supplierId");

-- AddForeignKey
ALTER TABLE "SupplierBidIntent" ADD CONSTRAINT "SupplierBidIntent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierBidIntent" ADD CONSTRAINT "SupplierBidIntent_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierBidNoShow" ADD CONSTRAINT "SupplierBidNoShow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierBidNoShow" ADD CONSTRAINT "SupplierBidNoShow_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
