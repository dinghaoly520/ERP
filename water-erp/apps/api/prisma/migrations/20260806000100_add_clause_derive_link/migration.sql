-- Phase 1: 条款派生草稿开关 + 得分点↔条款映射
ALTER TABLE "BidProject" ADD COLUMN "clauseDeriveEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BidScorePoint" ADD COLUMN "linkedRequirementIds" JSONB;
