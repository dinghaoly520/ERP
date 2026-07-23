#!/bin/bash
# water_erp 全量逻辑备份（docker exec 内跑 pg_dump，绕过 pgbouncer 直连 postgres）
# 用法：pnpm db:backup  或  bash scripts/db-backup.sh
# 环境变量：PG_CONTAINER / DB_USER / DB_PASS / DB_NAME / BACKUP_KEEP_DAYS（默认 14）
set -euo pipefail

CONTAINER="${PG_CONTAINER:-water-erp-postgres}"
DB_USER="${DB_USER:-water_erp}"
DB_PASS="${DB_PASS:-water_erp_dev}"
DB_NAME="${DB_NAME:-water_erp}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/water_erp_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
echo "[db-backup] $(date -Is) start → $OUT"

# --clean --if-exists：恢复到已有库时先 DROP 再建，幂等；分区表 DDL 按依赖顺序导出
if ! docker exec -e PGPASSWORD="$DB_PASS" "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists 2>/tmp/db-backup-err.log | gzip > "$OUT"; then
  echo "[db-backup] ERROR: pg_dump failed"; head -5 /tmp/db-backup-err.log >&2; rm -f "$OUT"; exit 1
fi
[ -s "$OUT" ] || { echo "[db-backup] ERROR: empty dump"; rm -f "$OUT"; exit 2; }

# 剪枝：删除超过 KEEP_DAYS 的旧备份
find "$BACKUP_DIR" -name 'water_erp_*.sql.gz' -type f -mtime +"$KEEP_DAYS" -print -delete || true

echo "[db-backup] OK $(du -h "$OUT" | cut -f1) (keep ${KEEP_DAYS}d)"
