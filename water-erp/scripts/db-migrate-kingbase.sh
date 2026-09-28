#!/usr/bin/env bash
# 金仓(KingbaseES PG 模式)迁移部署——自动处理两个已知的金仓差异，其余失败原样上抛人工介入：
#   1) gen_random_uuid() 缺失      → CREATE EXTENSION kbcrypto 后重试（老内核无 PG13+ 内建 UUID）
#   2) pgvector 迁移(20260727...)   → 向量由 sidecar 承载，主库跳过（migrate resolve --applied）
# 前置：向量侧另起 sidecar（docker compose --profile vector-sidecar up -d pgvector），
#       API 设 VECTOR_DATABASE_URL 指向它。
# 用法（在 water-erp/ 下）：
#   DATABASE_URL='postgresql://system:PWD@HOST:54321/water_erp?schema=public' \
#   DIRECT_URL='postgresql://system:PWD@HOST:54321/water_erp' \
#   ./scripts/db-migrate-kingbase.sh
set -uo pipefail
cd "$(dirname "$0")/../apps/api"

: "${DIRECT_URL:?需设置 DIRECT_URL（金仓直连，prisma migrate 用）}"
: "${DATABASE_URL:?需设置 DATABASE_URL}"

log=$(mktemp)
trap 'rm -f "$log"' EXIT

for attempt in 1 2 3 4; do
  echo "▶ prisma migrate deploy（第 ${attempt} 次）"
  if npx prisma migrate deploy 2>&1 | tee "$log"; then
    echo "✔ 全部迁移已应用"
    exit 0
  fi
  mig=$(grep -o 'Migration name: [^ ]*' "$log" | tail -1 | cut -d' ' -f3)
  if grep -q 'gen_random_uuid' "$log"; then
    echo "▶ 金仓缺 gen_random_uuid()，启用 kbcrypto 后重试"
    npx prisma db execute --url "$DIRECT_URL" --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS kbcrypto;
SQL
    [ -n "$mig" ] && npx prisma migrate resolve --rolled-back "$mig"
  elif grep -q 'vector.control' "$log"; then
    echo "▶ 金仓无 pgvector（向量由 sidecar 承载），主库跳过该迁移：$mig"
    [ -n "$mig" ] && npx prisma migrate resolve --applied "$mig"
  else
    echo "✘ 未预期的迁移失败（$mig），人工介入；日志："
    tail -30 "$log"
    exit 1
  fi
done
echo "✘ 重试次数用尽"
exit 1
