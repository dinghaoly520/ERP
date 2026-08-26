-- W2 时间规则引擎（B-004/B-009）：依法必招标志
ALTER TABLE "BidProject" ADD COLUMN "legalMandatory" BOOLEAN NOT NULL DEFAULT false;
