# backend —— NestJS API + 基础设施 Docker 部署（第二套·v2 免快照）

| 容器 | 镜像 | 宿主机端口 | 说明 |
|---|---|---|---|
| water-erp-be-api | water-erp-api:1.0.0 | **4001** | NestJS 11 + Prisma 6，前端门户的对接目标 |
| water-erp-be-postgres | pgvector/pgvector:pg16 | 15432→5432 | schema 含 vector 列必须 pgvector |
| water-erp-be-redis | redis:7-alpine | 16380→6379 | BullMQ 队列/会话 |
| water-erp-be-minio | minio/minio:latest | 19000/19001 | 对象存储（文件上传/presigned） |

**v2 关键变化：不再做源码快照（repo/）**。api 镜像的构建上下文直接用仓库根
`/data/water-erp/water-erp`——与前端套同一个 context，仓库根 `.dockerignore` 已把
node_modules/.next/zhishiku 等全部排除（上下文实际只有几百 MB），快照只是它的复制品，纯多余。
本目录共 4 个文件，setup 脚本对仓库的写入仅两个新增文件：`docker/backend/Dockerfile.api` 与仓库根 `.dockerignore`。

端口全部避让（5432/6379/9000/9001 被 dify 等占用）。**pgbouncer 已移除**（该机拉 alpine+apk 不通，
208 核主机 API 直连 PG 足够）。数据卷 `water-erp-be-*` 持久——容器/镜像删了数据还在。

> **本轮已用临时账号在 192.168.3.114 实测通过**：`setup_backend.sh` 全流程 STEP0→STEP8 全绿，
> `water-erp-api:1.0.0` 构建成功、api 容器 healthy、`4001/api/health` 返回 `{"status":"ok","database":"ok","redis":"ok"}`。
> 修复链：EEXIST（补回 `rm -f` corepack 垫片）→ 58 个 TS2307（`.dockerignore` 里 `services` 未锚定误删
> `apps/api/src/**/services/*.ts`，已改为 `/services`）→ 构建通过。

## 一、目录结构（服务器上即此布局）

```
/data/water-erp/backend/
├── docker-compose.backend.yml    ← 本目录归档同名文件（build context = ${REPO_DIR:-/data/water-erp/water-erp}）
├── Dockerfile.api                ← api 镜像构建文件（setup 会拷进仓库 docker/backend/）
├── .dockerignore                 ← 构建忽略清单（setup 会拷到仓库根；services/uploads 等已锚定为顶层）
├── setup_backend.sh              ← 一键部署脚本（幂等，可反复重跑；以 root 执行）
└── .env.backend                  ← 运行时密钥（setup 自动从仓库 apps/api/.env 派生，勿手改密钥值）
```

旧版遗留的 `/data/water-erp/backend/repo/`、`/home/deploytmp/water-erp-backend/repo/` 快照目录
v2 已不使用，可让 root 直接删除。

> **重新解压 watererp.zip 后**：仓库根的 `.dockerignore` 会被 zip 里的旧版覆盖，但 `setup_backend.sh`
> 的 STEP1 会用本目录的锚定版 `.dockerignore` 重新覆盖它——所以务必用本 develop/backend 里的最新 4 个文件，
> 不要沿用 zip 内可能存在的旧 `.dockerignore`。

## 二、从零部署步骤（新机器/重建）

```bash
# 0. 前提：docker load 离线镜像 —— node:24.16.0-bookworm-slim、pgvector/pgvector:pg16、
#    minio/minio:latest（redis:7-alpine 机器上已有）。STEP0 会自动检查。
# 1. 本目录 3 个文件放到 /data/water-erp/backend/，以 root 执行：
cd /data/water-erp/backend && bash setup_backend.sh
# 脚本步骤：镜像检查→放置 Dockerfile.api→派生 .env.backend（沿用原密钥，保数据兼容）
#           →build api 镜像（上下文=仓库根）→起 pg/redis/minio→migrate（幂等）
#           →seed（User 表非空自动跳过，防 TRUNCATE 清库）→起 api→健康+门户代理验证
# 2. 验证
curl -s http://127.0.0.1:4001/api/health     # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

## 三、异机部署：A 机打包镜像 → B 机直接跑（B 机无需源码、无需联网构建）

**分工**：A 机只需 Docker + 能访问 npm（构建期联网）；B 机**只要有 Docker**——api 镜像里已
打进 prisma schema、迁移文件、seed 脚本和全部 node_modules，migrate/seed 都在容器内执行，B 机不需要仓库。

```bash
# ========== A 机 ==========
# 1. 构建 api 镜像（上下文=仓库根，setup 已放好 Dockerfile.api）
cd /data/water-erp/backend
docker compose -f docker-compose.backend.yml build api
# 2. 导出 api 镜像
docker save water-erp-api:1.0.0 -o water-erp-api.tar
# 3. 三个基础镜像若 B 机没有，同样从 A 机 save（本机都是 load 进来的，A 机也 load 过就能直接导）
docker save pgvector/pgvector:pg16 -o pgvector.tar
docker save redis:7-alpine         -o redis7.tar
docker save minio/minio:latest     -o minio.tar
# 4. 传到 B 机同一目录（约 1.7GB：api 镜像 + 3 个基础镜像 tar）
scp water-erp-api.tar pgvector.tar redis7.tar minio.tar docker-compose.backend-run.yml .env.backend user@B机IP:/opt/water-erp-api/

# ========== B 机 ==========
cd /opt/water-erp-api
# 5. 导入 4 个镜像
docker load -i water-erp-api.tar
docker load -i pgvector.tar
docker load -i redis7.tar
docker load -i minio.tar
docker images | grep -E 'water-erp-api|pgvector|redis|minio'   # 4 个都在
# 6. ⚠ 改 .env.backend 里 MINIO_ENDPOINT 为 B 机自己的 IP（presigned URL 面向浏览器）
sed -i "s#^MINIO_ENDPOINT=.*#MINIO_ENDPOINT=<B机IP>#" .env.backend
# 7. 起基础设施（用 run 版：无 build 段，不会尝试构建）
docker compose -f docker-compose.backend-run.yml up -d postgres redis minio
# 8. 建表 + 灌数据（空库才 seed；都在容器内跑，无需源码）
docker compose -f docker-compose.backend-run.yml --profile tools run --rm migrate
docker compose -f docker-compose.backend-run.yml --profile tools run --rm seed   # 已有数据可跳过
# 9. 起 API
docker compose -f docker-compose.backend-run.yml up -d api
curl -s http://127.0.0.1:4001/api/health     # 期望 {"status":"ok",...,"database":"ok","redis":"ok"}
```

B 机后续运维（同样用 run 版文件）：
```bash
docker compose -f docker-compose.backend-run.yml restart api
docker compose -f docker-compose.backend-run.yml ps
```

**注意点**：
1. **前后端可分机，但要改前端构建**：前端 3002/3006/3007 门户把后端地址 `host.docker.internal:4001`
   固化进了镜像。若后端放 B 机、前端也放 B 机，则无碍；若前后端分两台机，前端镜像必须在 A 机
   build 时用 `--build-arg API_ORIGIN=http://<后端机IP>:4001` 重打，否则门户连不上后端。
   3004/3005 走运行期代理，改 `.env.frontend` 的 API_ORIGIN 即可、无需重建。
2. **架构匹配**：A、B 同为 x86_64 Linux 则镜像通用；若 A 是 ARM（Mac），A 机 build 用
   `docker buildx build --platform linux/amd64`，save 出来的 tar 才能在 B(x86_64) 上跑。
3. **密钥一致性**：`.env.backend` 从 A 机原样带过去（JWT/KMS 等沿用仓库原值），
   保证 B 机新 seed 的数据与密钥自洽。不要改密钥，除非打算重灌数据。
4. 端口若与 B 机已有服务冲突，改 run 版文件里的 `15432/16380/19000/19001` 映射即可（4001 尽量保留，前端固化的是它）。

## 四、日常运维

```bash
cd /data/water-erp/backend
docker compose -f docker-compose.backend.yml restart api       # 重启 API
docker logs -f water-erp-be-api                                # 跟日志
docker compose -f docker-compose.backend.yml stop api          # 只停 API（数据服务继续跑）
docker exec water-erp-be-postgres psql -U water_erp -d water_erp -c 'select count(*) from "User"'
```

## 五、要点与注意

1. **连接串**：API 容器内 DATABASE_URL 直连 `postgres:5432`；MinIO 用
   `MINIO_ENDPOINT=192.168.3.114:19000`（presigned URL 要浏览器可达）。
2. **NODE_ENV=development**（默认）：CORS 全放行、Swagger 在 `/api/docs`。上生产改 production 前先在 .env.backend 配 `CORS_ORIGINS`。
3. **密钥与数据兼容**：JWT_SECRET/KMS_SECRET 沿用仓库 apps/api/.env 原值，保证 seed 加密数据可解；换密钥必须同步重灌数据。
4. **seed 会 TRUNCATE 重载**：脚本已自动判空跳过；手动重跑前确认这是你要的。
5. **构建需要 npm 可达**：走 npmmirror + `network: host`（绕该机构建容器 DNS 缺陷）+ store 缓存挂载；与前端套共用缓存层，重建很快。
6. 数据卷 `down -v` 会清空，慎用；普通 `down` 不删数据。
7. 金仓数据库未启用（Prisma provider 是 postgresql）；切换属独立专项，见仓库 scripts/db-migrate-kingbase.sh。
8. **UKey 验签**：镜像构建期删除了 packages/ukey 里引用缺失源文件（scca-*）的两行导出；
   api 主链路不受影响，需要真实 UKey 功能时补齐源文件重新 build。
9. **已知限制（本机实测）：容器内访问 `192.168.3.114:19000`（LAN IP 回环 hairpin）超时**，
   导致 UploadService 启动时 MinIO bucket 初始化报 `connect ETIMEDOUT`（仅记日志，不阻塞 API 启动与其余接口）。
   同网络内走服务名 `minio:9000` 正常（实测 200）。影响面=文件上传/下载功能；若需要修复：
   把 .env.backend 的 `MINIO_ENDPOINT=minio`、`MINIO_PORT=9000`（上传即通，但 presigned 下载链接
   主机名是 minio，需在访问端 hosts 加 `192.168.3.114 minio`），或后续给 api 容器改 host 网络方案。
