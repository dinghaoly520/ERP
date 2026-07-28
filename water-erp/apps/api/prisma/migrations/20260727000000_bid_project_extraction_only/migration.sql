-- 自定义抽取影子项目标记：仅承载专家抽取/通知/确认，不出现在项目管理列表
ALTER TABLE "BidProject" ADD COLUMN "isExtractionOnly" BOOLEAN NOT NULL DEFAULT false;
