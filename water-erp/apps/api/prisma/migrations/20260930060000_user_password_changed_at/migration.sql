/*
  R6-5①（2026-09-30 审计 A-1）：重置/修改密码后全命名空间旧 token 立即失效。
  token_bid 无 sid 此前不拦——:3007 会话照活到 7 天 JWT 过期，与 UI"所有已登录
  会话立即失效"承诺相反。AuthGuard 以 JWT iat < passwordChangedAt 统一拦截。

  注：手工迁移（db execute + migrate resolve）——沿用 assistant_guest_key 配方。
*/
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
