-- :3005 单设备登录（2026-08-21）：同一账号同一时间只允许一台设备在线
-- 机制：web 门户（token_web）登录时轮换 webSessionId 并把 sid 写入 JWT；
--       AuthGuard 校验 JWT.sid 与库中 webSessionId 一致，不一致 → 401 SESSION_REPLACED。
-- 定点迁移：prisma db execute --url $DIRECT_URL --file 本文件 → migrate resolve --applied

ALTER TABLE "User" ADD COLUMN "webSessionId" TEXT;
