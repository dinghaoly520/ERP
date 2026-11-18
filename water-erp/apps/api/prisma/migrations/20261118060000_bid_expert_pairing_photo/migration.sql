-- 配对留档照三件套（2026-11-18 生产 bug 修复）：平板配对拍照此前被服务端丢弃成孤儿资产，落库方可在 :3007 展示
ALTER TABLE "BidExpert" ADD COLUMN "transferPhotoAssetId" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "transferPhotoAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN "transferPhotoOcclusion" TEXT;
