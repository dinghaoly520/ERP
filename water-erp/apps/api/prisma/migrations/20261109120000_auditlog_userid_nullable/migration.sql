-- 专家名单一键清空（clearExpertRoster，2026-11-09）断链保痕前置：
-- AuditLog.userId 可空化——删用户前先把其审计行 userId 置 null，
-- 否则 onDelete Cascade 会级联毁掉被删用户的全部法定留痕（不止专家场景）
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
