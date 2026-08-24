-- P1-14：归档哈希链签字包指纹持久化（archiveAll 写入，verify/export 重算回读，修复恒 mismatch）
ALTER TABLE "BidArchiveItem" ADD COLUMN "fileHashes" JSONB;
