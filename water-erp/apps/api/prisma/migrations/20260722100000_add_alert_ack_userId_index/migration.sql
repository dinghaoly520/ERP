-- #14 补齐 schema 已声明但此前迁移遗漏的索引，消除 migrate diff / db push 的 drift。
CREATE INDEX IF NOT EXISTS "QualificationAlertAck_userId_idx" ON "QualificationAlertAck"("userId");
