#!/usr/bin/env bash
# 哨兵式启动（随 pnpm dev 接入，2026-09-18）：:17999 已有常驻实例（systemd ukey-mw-usb /
# 便携 U盘启动脚本）则让位跳过，空闲才拉起 U盘模式中间件——避免与常驻服务抢端口。
# 无 U盘时以空盾列表启动（listShields 对空目录返 []，不报错）；插盘后实时可见。
cd "$(dirname "$0")"
if curl -sf --max-time 2 http://127.0.0.1:17999/health >/dev/null 2>&1; then
  echo "[ukey-mw-guard] :17999 已有中间件在跑（systemd/便携盘常驻），让位跳过"
  exit 0
fi
echo "[ukey-mw-guard] :17999 空闲，拉起 U盘模式中间件"
exec bash start-usb.sh
