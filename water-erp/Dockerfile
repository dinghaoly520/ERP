# =============================================================================
# 新增文件 —— water-erp 前端门户镜像（3002 / 3004 / 3005 / 3006 / 3007）
#
# 构建上下文 = water-erp/ 仓库根目录（原始结构保持不动，靠 .dockerignore 精简）
# 用法（在 water-erp 目录下）：
#   docker build -f docker/frontend/Dockerfile -t water-erp-portal:1 .
# 后端地址（3002/3006/3007 的 rewrites 在构建期固化，必须这里给对）：
#   docker build -f docker/frontend/Dockerfile --build-arg API_ORIGIN=http://10.20.145.7:4001 -t water-erp-portal:1 .
# =============================================================================
FROM node:24.16.0-bookworm-slim

WORKDIR /repo
RUN corepack enable

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=4096

# 依赖源：默认走 npmmirror（国内可达）。内网私有源改这里或 compose build args：
#   --build-arg NPM_REGISTRY=http://nexus.internal:8081/repository/npm-group/
ARG NPM_REGISTRY=https://registry.npmmirror.com
# corepack 下载 pnpm 本体 + pnpm 下载所有依赖包，都走同一源
# （否则 corepack 与 pnpm 默认硬连 registry.npmjs.org，内网会 EAI_AGAIN）
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY}

# ---- 工具链版本对齐构建机（npm 11.13.0 / pnpm 11.6.0）----
# npm -g 安装覆盖 corepack 的 pnpm shim，容器内强制 pnpm 11.6.0，
# 不再受仓库 package.json 的 packageManager=pnpm@10.33.0 约束。
# pnpm 11 只从 .npmrc 读 registry、其余配置走 pnpm-workspace.yaml/环境变量，
# npm_config_* 前缀也已废弃 → registry 写入 /root/.npmrc 双保险。
# corepack enable 已在 /usr/local/bin 放了 pnpm/yarn 垫片，npm -g 再装 pnpm 会
# 报 EEXIST 冲突 → 先删垫片再装（删后 pnpm 完全由 npm 全局版本接管）。
RUN rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx \
         /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && npm install -g npm@11.13.0 pnpm@11.6.0 \
 && pnpm --version && npm --version \
 && printf 'registry=%s\n' "$NPM_REGISTRY" > /root/.npmrc

# 构建期后端地址：public/expert/bid 三门户 next.config.ts 的 rewrites 目标
# 来自 @water-erp/config 的 apiOrigin()，next build 时被固化进产物
ARG API_ORIGIN=http://host.docker.internal:4001
ENV API_ORIGIN=${API_ORIGIN}

# -----------------------------------------------------------------------------
# 分层拷贝：先清单，命中依赖层缓存
# -----------------------------------------------------------------------------
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/public-portal/package.json        apps/public-portal/
COPY apps/supplier-portal-next/package.json apps/supplier-portal-next/
COPY apps/web/package.json                  apps/web/
COPY apps/expert-portal/package.json        apps/expert-portal/
COPY apps/bid-portal/package.json           apps/bid-portal/
COPY apps/api/package.json                  apps/api/
COPY apps/assistant/package.json            apps/assistant/
COPY apps/bigscreen/package.json            apps/bigscreen/
COPY packages/config/package.json           packages/config/
COPY packages/shared/package.json           packages/shared/
COPY packages/client/package.json           packages/client/
COPY packages/ukey/package.json             packages/ukey/
# 说明：packages/ui 在仓库里没有 package.json（不属于 workspace 成员），故不拷贝

# 只装 5 个门户及其 workspace 依赖（含各自传递依赖），
# 跳过 api 的 prisma/nest 等重型包，安装量与时间都大幅下降
# pnpm 11 默认 strictDepBuilds：未显式放行的依赖构建脚本会直接报
# ERR_PNPM_IGNORED_BUILDS，故用官方 CLI 开关 --dangerously-allow-all-builds 放行
# （已对 pnpm 11.6.0 包体核实该开关存在）。构建环境是一次性容器，风险可控。
# 另外仓库 pnpm-workspace.yaml 是 v10 写法（onlyBuiltDependencies +
# ignoredBuiltDependencies），pnpm 11 视后者为 neverBuiltDependencies，与前者互斥
# 报 ERR_PNPM_CONFIG_CONFLICT_BUILT_DEPENDENCIES。原文件不可改 → 只删容器内副本
# 的这两段（位于文件末尾，packages: 定义在前面，不受影响）。
# --no-frozen-lockfile：仓库 pnpm-lock.yaml 本身已过期（packages/ukey 的锁记录缺
# 少 package.json 里的 4 个 devDependencies），frozen 严格校验必失败；放开后在
# semver 范围内重新解析，只改容器内副本的锁文件，不动服务器上的原文件。
# --fetch-timeout=600000 / --fetch-retries=5：服务器到 npmmirror 偶发慢，默认 60s
# 超时 + 2 次重试不够（ERR_SOCKET_TIMEOUT），拉长超时并多重试。
# --mount=type=cache：已下载的包存入 BuildKit 缓存，本次失败后重跑不用重新下载；
# 要求 compose v2（默认启用 BuildKit），若用经典 builder 需删掉本行。
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    sed -i '/^onlyBuiltDependencies:/,$d' pnpm-workspace.yaml \
 && pnpm install --no-frozen-lockfile --dangerously-allow-all-builds \
      --fetch-timeout=600000 --fetch-retries=5 --network-concurrency=4 \
      --filter public-portal... \
      --filter supplier-portal-next... \
      --filter web... \
      --filter expert-portal... \
      --filter bid-portal...

# -----------------------------------------------------------------------------
# 再拷源码（node_modules / .next / zhishiku 等已被 .dockerignore 排除）
# -----------------------------------------------------------------------------
COPY . .

# 1) 共享包必须先出 dist（package.json 的 main 指向 ./dist/index.js）
# 仓库 packages/ukey/src/index.ts 引用了 scca-transport / scca-ukey 两个源码文件，
# 但 zip 里缺失（仅 api 后端用到，前端 5 门户零引用）→ tsc 必失败。
# 只删容器内副本的两行导出，服务器原文件不动；前端不需要 scca 能力。

 RUN pnpm --filter @water-erp/config run build \
 && pnpm --filter @water-erp/shared run build \
 && pnpm --filter @water-erp/client run build \
 && pnpm --filter @water-erp/ukey   run build

# 2) 5 个门户（expert-portal 的 prebuild 会自动把 mediapipe wasm 拷进 public/）
RUN pnpm --filter public-portal        run build \
 && pnpm --filter supplier-portal-next run build \
 && pnpm --filter web                  run build \
 && pnpm --filter expert-portal        run build \
 && pnpm --filter bid-portal           run build

EXPOSE 3002 3004 3005 3006 3007

# 默认起 3002，docker-compose 用 command 覆盖成各自门户
CMD ["sh", "-c", "pnpm --filter public-portal exec next start -H 0.0.0.0 -p 3002"]
