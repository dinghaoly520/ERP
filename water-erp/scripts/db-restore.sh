#!/bin/bash
# 从 db-backup.sh 的备份恢复
# 用法：bash scripts/db-restore.sh backups/water_erp_YYYYMMDD_HHMMSS.sql.gz [目标库名]
# 恢复到非默认库（如测试往返）：先 createdb 再传第二参数
# 环境变量：PG_CONTAINER / DB_USER / DB_PASS
set -euo pipefail

FILE="${1:?用法: db-restore.sh <backup.sql.gz> [target_db]}"
TARGET_DB="${2:-water_erp}"
CONTAINER="${PG_CONTAINER:-water-erp-postgres}"
DB_USER="${DB_USER:-water_erp}"
DB_PASS="${DB_PASS:-water_erp_dev}"

[ -f "$FILE" ] || { echo "[db-restore] 文件不存在: $FILE"; exit 1; }
echo "[db-restore] $FILE → db=$TARGET_DB （5 秒后开始，Ctrl-C 可中止）"
sleep 5

gunzip -c "$FILE" | docker exec -i -e PGPASSWORD="$DB_PASS" "$CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q
echo "[db-restore] OK"
