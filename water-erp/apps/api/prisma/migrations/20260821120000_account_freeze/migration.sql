-- 账号冻结（2026-08-21 账号管理）：管理员可冻结账号；
-- 冻结 ≠ 未激活（isActive=false 表示注册待审核/退役），登录与守卫分别给出「账号已被冻结」提示。
-- 定点迁移：prisma db execute --url $DIRECT_URL --file 本文件 → migrate resolve --applied

ALTER TABLE "User" ADD COLUMN "isFrozen" BOOLEAN NOT NULL DEFAULT false;
