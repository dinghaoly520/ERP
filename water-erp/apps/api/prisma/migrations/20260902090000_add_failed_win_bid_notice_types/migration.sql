-- 公告类型新增：流标公告 / 中标公告（系统在项目流程中生成：发布向导 failed_bid / winning_bid 类目）
-- 原先这两类公告复用 BID_NOTICE 发布，列表中无法与采购公告区分。
ALTER TYPE "AnnouncementType" ADD VALUE IF NOT EXISTS 'FAILED_BID_NOTICE';
ALTER TYPE "AnnouncementType" ADD VALUE IF NOT EXISTS 'WIN_BID_NOTICE';
