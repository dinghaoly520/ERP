-- 阳光采购对接档案（2026-10-28）：平台侧组织档案六字段，公司信息管理维护、发布弹窗自动带出
ALTER TABLE "companies" ADD COLUMN "sunshineOrganizationCode" TEXT;
ALTER TABLE "companies" ADD COLUMN "sunshineOrganizationUnique" TEXT;
ALTER TABLE "companies" ADD COLUMN "sunshineParentOrganization" TEXT;
ALTER TABLE "companies" ADD COLUMN "sunshineProcuringEntity" TEXT;
ALTER TABLE "companies" ADD COLUMN "sunshineStandardQuota" TEXT;
ALTER TABLE "companies" ADD COLUMN "sunshinePublicQuota" TEXT;
