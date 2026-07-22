-- AlterTable: QualificationAlertAck 增 supplierId，支撑 Supplier.alertAcks 反关系
ALTER TABLE "QualificationAlertAck" ADD COLUMN "supplierId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "QualificationAlertAck" ADD CONSTRAINT "QualificationAlertAck_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
