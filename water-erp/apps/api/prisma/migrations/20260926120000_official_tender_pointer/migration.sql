-- 正式盖章版采购文件指针 + 附件提取文本懒缓存（2026-09-26）
-- 03「采购文件」完成强制闸：OFFICIAL_TENDER_REQUIRED（不可豁免）

-- AlterTable
ALTER TABLE "ProjectManagementStage" ADD COLUMN     "officialTenderAttachmentId" TEXT,
ADD COLUMN     "officialTenderConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "extractedText" TEXT,
ADD COLUMN     "extractedTextAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ProjectManagementStage" ADD CONSTRAINT "ProjectManagementStage_officialTenderAttachmentId_fkey" FOREIGN KEY ("officialTenderAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
