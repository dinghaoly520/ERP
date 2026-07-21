-- AlterTable: 供应商停用原因(替代 returnReason 语义错用) + 淘汰时间(区分淘汰与手动停用)
ALTER TABLE "Supplier" ADD COLUMN "disableReason" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "eliminatedAt" TIMESTAMP(3);

-- CreateTable: 资质到期预警「已处理」确认记录(B11)，替代前端 sessionStorage
CREATE TABLE "QualificationAlertAck" (
    "id" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualificationAlertAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 同一用户对同一资质仅一条确认
CREATE UNIQUE INDEX "QualificationAlertAck_qualificationId_userId_key" ON "QualificationAlertAck"("qualificationId", "userId");

-- AddForeignKey
ALTER TABLE "QualificationAlertAck" ADD CONSTRAINT "QualificationAlertAck_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "SupplierQualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationAlertAck" ADD CONSTRAINT "QualificationAlertAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
