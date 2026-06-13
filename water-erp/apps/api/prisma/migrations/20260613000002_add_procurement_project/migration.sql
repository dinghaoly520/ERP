-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'BIDDING', 'CONTRACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "ProcurementProject" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "description" TEXT,
    "budget" DECIMAL(12,2),
    "procurementType" TEXT NOT NULL,
    "procurementMethod" TEXT NOT NULL,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectReason" TEXT,
    "departmentId" TEXT,
    "creatorId" TEXT,
    "bidProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementProject_projectCode_key" ON "ProcurementProject"("projectCode");
CREATE UNIQUE INDEX "ProcurementProject_bidProjectId_key" ON "ProcurementProject"("bidProjectId");
CREATE INDEX "ProcurementProject_status_idx" ON "ProcurementProject"("status");

-- AddForeignKey
ALTER TABLE "ProcurementProject" ADD CONSTRAINT "ProcurementProject_bidProjectId_fkey" FOREIGN KEY ("bidProjectId") REFERENCES "BidProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementProject" ADD CONSTRAINT "ProcurementProject_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementProject" ADD CONSTRAINT "ProcurementProject_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
