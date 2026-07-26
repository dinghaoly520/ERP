-- BidProject 采购文件下载截止时间（= 公告截止时间），超时不可下载采购文件
ALTER TABLE "BidProject" ADD COLUMN IF NOT EXISTS "downloadDeadline" TIMESTAMP(3);
