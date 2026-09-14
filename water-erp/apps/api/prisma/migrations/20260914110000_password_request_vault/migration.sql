-- 2026-09-14 admin 密码查看扩展到工作人员：审批请求表存加密的新密码副本（批准时落 User.passwordVault）
ALTER TABLE "PasswordChangeRequest" ADD COLUMN "requestedPasswordVault" TEXT;
ALTER TABLE "PasswordResetRequest" ADD COLUMN "requestedPasswordVault" TEXT;
