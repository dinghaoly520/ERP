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

# 分区表 dump 的已知良性错误：子分区继承约束不允许单独 DROP（随父表/父约束级联消失，
# dump 里那条 ALTER ... DROP CONSTRAINT IF EXISTS 恒失败）。去掉 ON_ERROR_STOP 放行这一类，
# 其余任何 ERROR 仍按失败处理，保持 fail-fast 语义（2026-09-14 实录：OperationLog_default_pkey）。
ERR_LOG="$(mktemp)"
gunzip -c "$FILE" | docker exec -i -e PGPASSWORD="$DB_PASS" "$CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" -q 2> "$ERR_LOG" || true
UNEXPECTED=$(grep 'ERROR' "$ERR_LOG" | grep -v 'cannot drop inherited constraint' || true)
if [ -n "$UNEXPECTED" ]; then
  echo "[db-restore] ERROR: 恢复出现非预期错误："; echo "$UNEXPECTED" | head -10 >&2; rm -f "$ERR_LOG"; exit 1
fi
echo "[db-restore] 良性跳过（分区继承约束 DROP）$(grep -c 'cannot drop inherited constraint' "$ERR_LOG" || true) 处"
rm -f "$ERR_LOG"
echo "[db-restore] OK"
