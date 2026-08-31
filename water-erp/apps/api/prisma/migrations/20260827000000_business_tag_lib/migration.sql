-- 业务标签库：注册选择制 + 供应商自创（审核入池）
CREATE TYPE "TagStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "BusinessTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TagStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'seed',
    "createdBySupplierId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessTag_name_key" ON "BusinessTag"("name");
CREATE INDEX "BusinessTag_status_idx" ON "BusinessTag"("status");

ALTER TABLE "BusinessTag" ADD CONSTRAINT "BusinessTag_createdBySupplierId_fkey" FOREIGN KEY ("createdBySupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessTag" ADD CONSTRAINT "BusinessTag_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 预置常用采购品类标签（种子即入库可选）
INSERT INTO "BusinessTag" ("id", "name", "status", "source", "createdAt", "updatedAt") VALUES
  (md5('tag-1')  || '-seed', '办公用品',     'APPROVED', 'seed', now(), now()),
  (md5('tag-2')  || '-seed', '钻机销售',     'APPROVED', 'seed', now(), now()),
  (md5('tag-3')  || '-seed', '水泵',         'APPROVED', 'seed', now(), now()),
  (md5('tag-4')  || '-seed', '阀门',         'APPROVED', 'seed', now(), now()),
  (md5('tag-5')  || '-seed', '供水设备',     'APPROVED', 'seed', now(), now()),
  (md5('tag-6')  || '-seed', '水利施工',     'APPROVED', 'seed', now(), now()),
  (md5('tag-7')  || '-seed', '市政工程',     'APPROVED', 'seed', now(), now()),
  (md5('tag-8')  || '-seed', '工程总承包',   'APPROVED', 'seed', now(), now()),
  (md5('tag-9')  || '-seed', '机电安装',     'APPROVED', 'seed', now(), now()),
  (md5('tag-10') || '-seed', '泵阀设备',     'APPROVED', 'seed', now(), now()),
  (md5('tag-11') || '-seed', '电气设备',     'APPROVED', 'seed', now(), now()),
  (md5('tag-12') || '-seed', '安防监控',     'APPROVED', 'seed', now(), now()),
  (md5('tag-13') || '-seed', '信息化服务',   'APPROVED', 'seed', now(), now()),
  (md5('tag-14') || '-seed', '软件开发',     'APPROVED', 'seed', now(), now()),
  (md5('tag-15') || '-seed', '测绘勘探',     'APPROVED', 'seed', now(), now()),
  (md5('tag-16') || '-seed', '检测检验',     'APPROVED', 'seed', now(), now()),
  (md5('tag-17') || '-seed', '水泥制品',     'APPROVED', 'seed', now(), now()),
  (md5('tag-18') || '-seed', '钢材贸易',     'APPROVED', 'seed', now(), now()),
  (md5('tag-19') || '-seed', '园林绿化',     'APPROVED', 'seed', now(), now()),
  (md5('tag-20') || '-seed', '环保治理',     'APPROVED', 'seed', now(), now()),
  (md5('tag-21') || '-seed', '物业服务',     'APPROVED', 'seed', now(), now()),
  (md5('tag-22') || '-seed', '交通运输',     'APPROVED', 'seed', now(), now()),
  (md5('tag-23') || '-seed', '实验室设备',   'APPROVED', 'seed', now(), now()),
  (md5('tag-24') || '-seed', '劳保用品',     'APPROVED', 'seed', now(), now());
