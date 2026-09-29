/*
  P0 会话隔离（2026-09-28 审计）：水叮当助手会话此前无属主（@Public + userId 恒空，
  全体用户共享可见可删）。现按认证态分层：认证用户记 userId（既有列），
  匿名访客记 guestKey（本迁移新增，:3008 localStorage 访客键）。

  注：手工迁移（db execute + migrate resolve）——migrate dev 因 User(companyId)
  索引的既有漂移要求 reset 整库，不可接受。
*/
-- AlterTable
ALTER TABLE "assistant_conversations" ADD COLUMN "guestKey" TEXT;

-- CreateIndex
CREATE INDEX "assistant_conversations_guestKey_idx" ON "assistant_conversations"("guestKey");
