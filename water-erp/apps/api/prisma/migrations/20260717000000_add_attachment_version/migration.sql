-- 采购文件补丁保存前的旧版本归档（定点补丁路径的回滚保险）
-- 仅新增 AttachmentVersion 表；不触碰历史漂移的其它字段。

CREATE TABLE "AttachmentVersion" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "originalHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttachmentVersion_objectKey_key" ON "AttachmentVersion"("objectKey");

CREATE INDEX "AttachmentVersion_attachmentId_idx" ON "AttachmentVersion"("attachmentId");

ALTER TABLE "AttachmentVersion" ADD CONSTRAINT "AttachmentVersion_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
