-- BidDocument 被变更公告替换标记（2026-11-20 变更采购文件）
ALTER TABLE "BidDocument" ADD COLUMN "supersededByAnnouncementId" TEXT;
