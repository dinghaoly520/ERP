-- 2026-09-26 公告回收站体系：状态枚举扩值（隐藏/下架）
ALTER TYPE "AnnouncementStatus" ADD VALUE 'HIDDEN';
ALTER TYPE "AnnouncementStatus" ADD VALUE 'OFFLINE';
