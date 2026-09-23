-- 工位迁移留档照严版（2026-09-23）：签到无留档照的专家迁移后强制补拍；
-- 摄像头不可用需主持人现场确认豁免（理由+确认人留痕），跳过仅在豁免后放行。
ALTER TABLE "BidExpert" ADD COLUMN "transferPhotoPendingAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN "transferPhotoExemptAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN "transferPhotoExemptByName" TEXT;
