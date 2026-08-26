-- B1（GB/T 43711 7.2.1.2）：采购方案要素补全 + D1 档案模板注记字段
-- AlterTable（B1）
ALTER TABLE "ProjectManagementItem" ADD COLUMN "implementerName" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "contractPricingType" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "sectionPlan" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "activitySchedule" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "riskMeasures" TEXT;

-- AlterTable（D1：档案项对应 GB 4.1.5.1 类别，人工登记时标注来源）
ALTER TABLE "BidArchiveItem" ADD COLUMN "gbCategory" TEXT;
