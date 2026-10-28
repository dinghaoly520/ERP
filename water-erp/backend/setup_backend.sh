#!/usr/bin/env bash
# =============================================================================
# 第二套·后端一键部署 v2.1（root 执行）
# 用法：cd <本目录> && bash setup_backend.sh
# 前提：node:24.16.0-bookworm-slim / pgvector/pg16 / redis:7-alpine / minio 镜像已 load
# 说明：构建上下文直接用仓库根（REPO），.dockerignore 由本脚本部署到仓库根；
#       对仓库的写入仅两个新增文件：docker/backend/Dockerfile.api 与 .dockerignore。
#       数据卷 water-erp-be-* 持久：已有数据时 seed 自动跳过，不会清库。
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${REPO:-/data/water-erp/water-erp}"
COMPOSE="$HERE/docker-compose.backend.yml"
ENVF="$HERE/.env.backend"
LAN_IP="${LAN_IP:-192.168.3.114}"
ts() { echo "[$(date '+%F %T')] $*"; }

# ---------- STEP0 镜像就绪检查（全部离线导入，不联网） ----------
ts "STEP0 检查本地镜像"
miss=0
for img in node:24.16.0-bookworm-slim pgvector/pgvector:pg16 redis:7-alpine minio/minio:latest; do
  if docker image inspect "$img" >/dev/null 2>&1; then ts "  有 $img"
  else ts "  缺 $img —— 请先 docker load 对应 tar"; miss=1; fi
done
[ "$miss" = 0 ] || exit 1

# ---------- STEP1 放置构建文件到仓库（纯新增，不动原文件） ----------
ts "STEP1 安装 Dockerfile.api 与 .dockerignore 到 $REPO"
mkdir -p "$REPO/docker/backend"
cp -f "$HERE/Dockerfile.api" "$REPO/docker/backend/Dockerfile.api"
# .dockerignore 决定上下文体积与权限安全（排除 node_modules/.data/zhishiku 等），必须部署
cp -f "$HERE/.dockerignore" "$REPO/.dockerignore"

# ---------- STEP2 派生 .env.backend（沿用 apps/api/.env 全部业务配置，保数据兼容） ----------
if [ ! -f "$ENVF" ]; then
  ts "STEP2 从 $REPO/apps/api/.env 派生 .env.backend"
  SRC="$REPO/apps/api/.env"
  [ -f "$SRC" ] || { ts "  !! 缺 $SRC，无法派生"; exit 1; }
  {
    echo "# 由 setup_backend.sh 派生（$(date '+%F %T')）；连接串由 compose 覆盖，密钥保持原值"
    grep -v '^#' "$SRC" | grep -E '^[A-Z_][A-Z0-9_]*=' | sed -E 's/\r$//' | awk -F= '
      /^DATABASE_URL=/||/^DIRECT_URL=/||/^REDIS_URL=/||/^MINIO_ENDPOINT=/||/^MINIO_PORT=/||/^MINIO_USE_SSL=/||/^MINIO_ACCESS_KEY=/||/^MINIO_SECRET_KEY=/||/^MINIO_BUCKET=/ {next}
      {print}
    '
    cat <<EOF
# ---- 对象存储：presigned URL 面向局域网浏览器 ----
MINIO_ENDPOINT=$LAN_IP
MINIO_PORT=19000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=water_erp_minio
MINIO_SECRET_KEY=water_erp_minio_dev
MINIO_BUCKET=water-erp
EOF
  } > "$ENVF"
  chmod 600 "$ENVF"
else
  ts "STEP2 已有 .env.backend，保留不覆盖"
fi

# ---------- STEP3 构建 api 镜像（上下文=仓库根；compose 已配 network:host） ----------
ts "STEP3 构建 water-erp-api:1.0.0（pnpm 缓存命中时约 3-6 分钟）"
cd "$HERE"
REPO_DIR="$REPO" docker compose -f docker-compose.backend.yml build api

# ---------- STEP4 起基础设施（命名卷持久，数据不丢） ----------
ts "STEP4 启动 postgres / redis / minio"
docker compose -f docker-compose.backend.yml up -d postgres redis minio
for i in $(seq 1 60); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' water-erp-be-postgres 2>/dev/null || echo init)
  [ "$st" = healthy ] && break
  sleep 2
done
ts "  postgres 状态: $st"
[ "$st" = healthy ] || exit 1

# ---------- STEP5 迁移（幂等，已应用过的不重复） ----------
ts "STEP5 prisma migrate deploy"
REPO_DIR="$REPO" docker compose -f docker-compose.backend.yml --profile tools run --rm migrate

# ---------- STEP6 种子（仅空库执行；有数据自动跳过，防 TRUNCATE 清库） ----------
cnt=$(docker exec water-erp-be-postgres psql -U water_erp -d water_erp -tAc 'SELECT count(*) FROM "User"' 2>/dev/null || echo 0)
if [ "${cnt:-0}" -gt 0 ]; then
  ts "STEP6 User 表已有 $cnt 条，跳过 seed（要重置演示数据：down -v 后重跑本脚本）"
else
  ts "STEP6 空库，执行 seed（约 1-2 分钟）"
  docker compose -f docker-compose.backend.yml --profile tools run --rm seed
fi

# ---------- STEP7 起 API 并健康验证 ----------
ts "STEP7 启动 api :4001"
docker compose -f docker-compose.backend.yml up -d api
ok=0
for i in $(seq 1 30); do
  sleep 10
  body=$(curl -s -m 8 http://127.0.0.1:4001/api/health || true)
  if echo "$body" | grep -q '"status":"ok"'; then ok=1; break; fi
done
ts "  /api/health: $body"
[ "$ok" = 1 ] || { ts "  !! API 未就绪：docker logs water-erp-be-api"; exit 1; }

# ---------- STEP8 前端联通验证（门户代理 → 4001） ----------
ts "STEP8 门户 → 后端联通检查"
for p in 3002 3004 3005; do
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$p/api/health" || echo 000)
  ts "  门户 $p /api/health -> $code"
done

ts "ALL_DONE 后端部署完成（water-erp-api:1.0.0；数据卷 water-erp-be-* 持久）"
