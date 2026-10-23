# 生产域名部署设计（scsfjt.com 子域 + nginx TLS 终结）

**日期**：2026-10-23　**状态**：已评审·待批准　**来源**：子域名申请单（2026-10-14 终版，已配置）

## 1. 意图与背景

本地开发全部门户走 `http://localhost:3xxx`。生产以「一套主域下的 7 个子域」上线，需要在不破坏本地开发形态的前提下，把跨门户跳转、会话 cookie、门户识别、WS、CORS、文件直连全部改为「环境变量驱动的域名形态」。

**生产事实（申请单）**：

- 主域 `scsfjt.com`，7 个子域：`ssyc`(信息门户:3002) / `api-ssyc`(API:4001) / `supplier-ssyc`(供应商:3004) / `expert-ssyc`(专家:3006) / `procurement-ssyc`(工作台:3005) / `bid-ssyc`(开评标:3007) / `mobile-ssyc`(移动端:3011)
- 服务器：内网 10.10.7.20，双公网出口 182.148.52.110 / 223.85.98.164（管理单位公网侧端口映射）
- 证书：泛域名 `*.scsfjt.com` 已申请；TLS 由我方在 10.10.7.20 用 nginx 终结
- 商城 :3003 / 水叮当 :3008 / 大屏 :3010 **刻意不上公网**（内网直连）
- URL 形态：按申请单「子域名+端口」列，暂定 `https://<子域>.scsfjt.com:<原端口>`；若公网映射实测是 443 统一入口，只改 env 矩阵，代码不变

## 2. 现状体检（2026-10-23 逐文件实测）

**已就位（无需改代码）**：

- 各门户 API 走同源 `/api`，由 `src/proxy.ts` 转发到 `API_ORIGIN`（别名 `API_SERVER_URL`），**注入 `X-Portal` 头 + 全量透传 Cookie** → 域名下经代理的请求门户识别天然成立
- `CORS_ORIGINS`：HTTP CORS（main.ts）+ bid/notification 两个 `wsCorsOrigin()` 镜像（生产均读同一 env）
- `TRUST_PROXY`、cookie `secure`（仅 production）、`CA_ALLOWED_ORIGINS`（生产未配置即拒绝放行）
- `notificationWsUrl()` 生产同源分支 + `NEXT_PUBLIC_WS_URL` 覆盖钩子
- `portal-link-origin.ts` 支持 env 显式覆盖（发给外部用户的链接）

**会断（本设计要修的 7 处）**：

1. **跨门户会话交接**：`COOKIE_OPTS` 不设 domain（host-only cookie），不同子域间不跟随——:3006 登录分流写 `token_bid` 跳 :3007、:3002 登录落地各门户全断
2. **`portalURL()`** 浏览器端硬拼 `http://${hostname}:${port}`（无 https、无域名）——所有跨门户跳转链接生成处
3. **直连 API 的门户识别**：`portalFromRequest` 的 Origin/Referer **端口号**反推在域名 URL（无端口）下失效 → 回退旧 `token` → 401（影响 api-ssyc 直连、SSO、curl、Swagger）
4. **WS**：握手门户判定按端口；且 `proxy.ts`（middleware）不能 Upgrade——同源 WS 必须由 nginx 直连 :4001
5. **零散 localhost 兜底**：public-portal SSR `API_BASE_URL||localhost:4001`、web 集采目录页 `MALL_URL/API_URL` 兜底、portal-link-origin 请求头推导分支产出 `http://host:port`
6. **MinIO presigned 直连**（expert_memo_ink 等绕过 streamFile 的类目）：签名 endpoint 为内网地址时公网浏览器不可达
7. **`deploy/` 目录不存在**：nginx/进程管理/构建部署/env 模板整套缺失

## 3. 目标 / 非目标 / 反目标

**目标**：

- 生产 7 子域全链路可用：登录、跨门户跳转（含专家端分流→开评标端）、文件下载、WS（通知/开标大厅/会场交流）、U盾 WebCrypto（https secure context）
- 本地开发（localhost:端口）行为**完全不变**——所有生产差异走 env，未设 env = 现状
- 交付 `deploy/` 目录：nginx 配置、systemd 单元、env 模板与生成脚本、部署 runbook

**非目标**：不改业务逻辑、不动数据库 schema；商城/水叮当/大屏公网化；CI/CD 流水线改造（手动 runbook 部署）。

**反目标**：代码出现任何硬编码 `scsfjt.com`（一律 env）；为域名形态牺牲本地开发体验（如本地强制 https）。

## 4. 设计决策

### D1 cookie 跨子域共享 —— `COOKIE_DOMAIN` env

- `COOKIE_OPTS` 增加 `domain: process.env.COOKIE_DOMAIN || undefined`；生产 `COOKIE_DOMAIN=scsfjt.com`
- 效果：`token_*` 系列对 `*.scsfjt.com` 全部可见，**原样复刻 localhost「端口共享 cookie」的架构假设**；门户间隔离靠既有 per-portal cookie 名（token_web/token_bid/…），跨门户交接流程（专家端分流、公共门户登录落地、移动端复用 token_web）零逻辑改动
- `sameSite=lax` 保持——同一 registrable domain 内属 same-site，顶层导航带 cookie，合法
- **副作用（须写进 runbook）**：设 Domain 后，用 `http://10.10.7.20:3005` 直连 IP 访问生产将拿不到登录 cookie（host 不在域下，浏览器拒收 Domain cookie）→ 内网访问必须走域名（见 D7）
- 实施要点：`res.cookie`/`res.clearCookie` 必须带同一 domain 才能删净——核对全部登出/会话失效路径

### D2 `portalURL()` 域名化 —— `NEXT_PUBLIC_PORTAL_ORIGINS`

- `packages/config/src/urls.ts` 新增：读 `NEXT_PUBLIC_PORTAL_ORIGINS`（JSON map：`{"public":"https://ssyc.scsfjt.com:3002","bid":"https://bid-ssyc.scsfjt.com:3007",…}`，构建期注入门户浏览器包）
- `portalURL(app)` 解析顺序：**env map 命中 → 现状 `http://hostname:port` 兜底**（本地开发不设 env，行为不变）；SSR 分支同样先查 env map（顺带消除 hydration 占位差异）
- `landingURL()`/各消费方零改动；专家端登录分流 `portalURL('bid','/bid')` 自动正确
- 10 个门户共用同一 JSON，`deploy/scripts/gen-portal-env.sh` 一处定义派生各门户 `.env.production`，防 10 份手写漂移

### D3 API 门户识别域名轨 —— `PORTAL_ORIGINS`（服务端）

- `portal-cookie.ts` 的 `portalFromRequest`：在「端口反推」之前加「Origin/Referer **完整 origin 匹配** → portal」映射（env `PORTAL_ORIGINS`，与 D2 同一 JSON、服务端进程注入）
- WS 握手（bid.gateway 等按 Origin 判门户处）同口径；**两处 `wsCorsOrigin()` 镜像 + 门户判定统一抽公共 util**——镜像漂移前科（评标口径三处镜像、启动评标闸门镜像漂移均踩过）
- `X-Portal` 头仍是第一优先（经门户 proxy.ts 的请求不受影响，此轨只救直连）

### D4 WS 路由与连接地址

- nginx 各门户 server 块：socket.io 握手路径（以客户端 `io()` 实测为准，默认 `/socket.io/*`）`proxy_http_version 1.1 + Upgrade` 直连 `127.0.0.1:4001`，并按块 `proxy_set_header X-Portal <portal>` 双保险；`proxy.ts`（middleware）无法 Upgrade，不经它
- 前端连接地址：生产统一「同源 + nginx Upgrade」或全量 `NEXT_PUBLIC_WS_URL=wss://…` 覆盖；实施时实测打通，**可能需小改各门户 realtime 客户端的 path/namespace 配置**（urls.ts 生产分支写的 `/api/notifications` 与服务端 namespace `notifications` 的对应关系要实测确认）
- 验收：通知铃铛、开标大厅实时解密、会场交流三链路在生产域名下绿

### D5 CORS / CA / 外链 env 矩阵

- `CORS_ORIGINS` = 全部 7 个 https origin（HTTP CORS 与 WS 共用）
- `CA_ALLOWED_ORIGINS=https://supplier-ssyc.scsfjt.com:3004`（SCCA 网关）
- `portal-link-origin` env 覆盖全配（EXPERT_PORTAL_URL / SUPPLIER_PORTAL_URL / WEB_PORTAL_URL…，供应商/专家收到的短信与邮件链接）
- public-portal SSR `API_BASE_URL` 与 `API_ORIGIN` 统一（消第二个名字）；web 集采目录页 `NEXT_PUBLIC_MALL_URL/NEXT_PUBLIC_API_URL` 生产给内网口径（见 D8）

### D6 MinIO presigned 公网可达

- `expert_memo_ink` 等直连类目：presigned URL 的签名 endpoint 必须浏览器可达 → storage 模块 endpoint 拆「内部操作地址（127.0.0.1:9000）/对外签名地址」双轨（现有 env 命名实施时核对，缺则新增 `MINIO_PUBLIC_ENDPOINT`）
- nginx：api-ssyc 块按 bucket 路径前缀路由到 MinIO（presigned 签名绑定 host+path，路由不改写路径即保持签名有效）
- 其余上传/下载走 `/api/upload/files/:id` 同源代理，不受影响

### D7 内网访问统一走域名

- 内网 DNS（或办公机 hosts）把 7 个子域解析到 10.10.7.20（split-horizon）；理由：D1 的 Domain cookie 在直连 IP 下被浏览器拒收 + 证书主机名匹配
- runbook 附 hosts 批量下发脚本；外部用户走公网映射不依赖此项

### D8 内部三应用（mall / assistant / bigscreen）

- 保持 `http://10.10.7.20:3003/3008/3010` 内网直跑（可经 nginx 仅内网监听，统一进程管理与日志）
- **已知局限**：公网工作台「进入商城」SSO——`token_mall` cookie 落在 `.scsfjt.com`，商城在内网 IP 上代理 `/api` 时 cookie 不跟随 → 该入口**仅内网域名口径下讨论**，生产 UI 标注「内网访问」；如未来需要公网商城再申请子域（env 已可表达，不在本期内）

### D9 `deploy/` 目录

- `deploy/nginx/`：单文件多 server 块模板（7 公网 + 内网三应用），含 WS Upgrade、bucket 路由、TLS 证书路径占位、HSTS 等安全头
- `deploy/systemd/`：api、ai-bid worker、OCR、7+3 门户、bigscreen 单元模板（`pnpm build` 产物 + `next start -p <port>` / `node dist/main.js`）
- `deploy/env/`：`api.env.production` 模板（全量矩阵+占位）、`gen-portal-env.sh`（一份 JSON 派生服务端 `PORTAL_ORIGINS` 与浏览器端 `NEXT_PUBLIC_PORTAL_ORIGINS`）
- `deploy/scripts/`：build-all.sh、deploy.sh
- `deploy/RUNBOOK.md`：裸机→上线分步清单（Node24/pnpm/DB（KingBase:54321 或 PG16 两分支）/Redis/MinIO/OCR/worker/证书部署/公网映射联调/验收用例）

## 5. 生产 env 矩阵（示例值，端口形态按实测锁定）

| 变量 | 值（示例） | 消费方 |
|---|---|---|
| `COOKIE_DOMAIN` | `scsfjt.com` | auth `COOKIE_OPTS`（D1） |
| `CORS_ORIGINS` | 7 个 https origin 逗号分隔 | HTTP CORS + `wsCorsOrigin()`（D5） |
| `PORTAL_ORIGINS` | 同 JSON map | `portalFromRequest` + WS 握手（D3） |
| `NEXT_PUBLIC_PORTAL_ORIGINS` | 同 JSON map | `portalURL()` 构建期（D2） |
| `API_ORIGIN` | `http://127.0.0.1:4001` | 各门户 proxy.ts |
| `CA_ALLOWED_ORIGINS` | `https://supplier-ssyc.scsfjt.com:3004` | CA 网关 |
| `TRUST_PROXY` | `1` | 反代后真实 IP（限流/审计） |
| `NEXT_PUBLIC_WS_URL`（可选） | `wss://…` | WS 直连覆盖（D4） |
| `MINIO_PUBLIC_ENDPOINT`（新增/核对） | `https://api-ssyc.scsfjt.com:4001` | presigned 签名（D6） |
| `EXPERT/SUPPLIER/WEB_PORTAL_URL` 等 | 各门户 https 地址 | 外发链接 origin（D5） |

API 自身仍监听 :4001 http；`api-ssyc` 子域供 Swagger/直连调试/MinIO 路由，同样挂 nginx TLS。

## 6. 数据与基础设施（runbook 范围，代码不动）

- 数据库：KingBase :54321（迁移 POC 已收宫）或 PG16 两分支任选，runbook 各写一段
- Redis / MinIO / OCR / ai-bid worker / bge-m3 embedding：随 systemd 单元上架；SCCA 网关与短信 provider 的生产参数留占位
- 首次数据：`db:seed` 或开发库备份恢复——部署时由用户裁定

## 7. 风险与部署时验证

- 公网映射形态（保留端口 or 443 统一）未实测锁定——env 矩阵两种都支持，联调时 curl 实测定稿
- 双公网出口（182.148.52.110 / 223.85.98.164）NAT 会话粘性：跨出口切换断 WS/长连接——观察项，必要时 DNS 收敛单出口
- 泛域名证书私钥在 10.10.7.20 的落地权限管理
- WS 客户端 path ↔ 服务端 namespace 生产分支（D4）需实测，可能是唯一要小改前端之处
- `clearCookie` 必须带同 domain（D1），逐条核对登出路径
- e2e 建议补一条「COOKIE_DOMAIN 下跨门户 cookie 可见」契约测试

## 8. 留给实施者的裁量

- `wsCorsOrigin()` 三处镜像抽公共 util 的落点与单测口径
- MinIO endpoint 现有 env 命名核对（`MINIO_PUBLIC_ENDPOINT` 或复用现有）
- bigscreen :3010 硬编码是否顺手 env 化（非必须）
- public-portal SSR `API_BASE_URL` 与 `API_ORIGIN` 合一的改法（保留别名兼容）

## 9. 建造者评审回执与裁定（2026-10-23）

独立评审对照源码逐条验证了第 2 节断言（属实），确认方案骨架成立，提出 6 个计划前置问题。处置如下。

### 已裁定（本文作者裁量，可被推翻）

- **B1 WS 主线 =「同源 + nginx Upgrade」**：每门户 server 块加 WS location 直连 `127.0.0.1:4001` 并注入 X-Portal；不用全量 `NEXT_PUBLIC_WS_URL` 直连（保留为应急覆盖）。**`NEXT_PUBLIC_PORTAL_ORIGINS` 必须含 `api` 条目**——`portalURL('api')` 被 bid/web/supplier 的 `use-bid-websocket` 与 expert 的 `use-expert-websocket` 共 5 处浏览器端 WS hook 消费，缺该条目会拼出 `http://<域名>:4001`（mixed content + 错误主机）生产必断。**服务端消费点分轨**：bid-portal/expert-portal 两处 `proxy.ts` 服务端调用的 `portalURL('api')`（auth/me 校验）一律改走 `API_ORIGIN` 内部地址（127.0.0.1:4001），不进 map——防双出口 NAT 回环不通。浏览器=map、服务端=apiOrigin()，此分轨写进 D2/D4 实施要点。
- **B2 Swagger 生产不挂**：`NODE_ENV=production` 语义不动（cookie secure/JWT 守卫/SMS bypass 拒绝全依赖它）。api-ssyc 定位收缩为「curl 直连调试 + MinIO presigned 路由 + WS 应急直连」；将来生产要 Swagger 走独立 env 开关另立任务（含 CSP/暴露面安全评审）。
- **B3 内外网统一 URL 形态**：canonical = 申请单「子域+端口」形态；公网联调实测若实为 443 统一入口，则**内外网一并切 443**。`NEXT_PUBLIC_PORTAL_ORIGINS` 是构建期单值，不接受「公网 443 / 内网带端口」双形态并存（否则内网点跨门户跳转被送错形态）。nginx 模板按最终形态二选一生成。
- **B4 专家平板设备识别**：本期只认显式声明（`device_mode` cookie / `?device=` / `/tablet/claim`），与现行「只认显式信号、已删 UA 猜测」的设计哲学一致；nginx 留 `X-Forwarded-Device` map 占位（注释块），开评标现场需要自动识别时提供无线子网网段即可启用，不阻塞本期。
- **B5 登录限流与双出口**：公网用户经 182.148.52.110/223.85.98.164 两出口汇聚，若映射设备不透传 X-Forwarded-For，全员共享 2 个 IP 桶（login 10/min 必误伤）——env 模板 `THROTTLE_LOGIN_LIMIT` 默认调大（60/min 起），联调实测 XFF 透传情况后定稿；透传则回调默认值。

### 待用户裁定（阻塞 runbook 章节深度，答案不同则交付物不同）

- **Q-A 服务器规格与出站网络**（10.10.7.20）：OS 与 CPU 架构（x86/ARM，决定原生二进制与构建产物）；能否出公网（决定「服务器上构建」vs「开发机构建+产物分发、服务器零构建」，以及 DeepSeek API 出站可用性=AI 功能是否进验收）；有无 GPU/内存量级（决定 bge-m3 本地 vLLM vs 已打通的在线 embedding API 分支）。
- **Q-B 首次数据路线**（三选一，env 模板密钥占位写法与 runbook 章节完全不同）：
  - A. `db:seed` 演示态上线（含英雄项目/演示供应商/180 名专家/`<用户名>@2026` 口令；生产跑 seed 需 `ALLOW_PROD_SEED=1` 放行）；
  - B. 开发库备份整体恢复：`KMS_SECRET`/`FIELD_ENC_SECRET` **复用开发值**，`ADMIN_KEYSTORE_DIR` + `.data/supervision/` + MinIO 全量对象随迁，上线前 `crypto-health-report` 体检（keystore 丢失=历史信封永久不可解）；
  - C. 空库 + 最小账号手工建档。

## 10. 用户裁定落地（2026-10-23）与离线生产形态

§9 两问的答复：**x86 架构；无出站公网（后期申请）；无 GPU；数据路线 = C（空库+手工最小账号）**。落地影响如下。

### 10.1 构建与分发：开发机构建，服务器零构建

- 全部构建在开发机完成（x86 同构），产物包分发到 10.10.7.20；服务器不装构建链、不触 registry
- 产物包内容：Next 门户产物（倾向 `output: 'standalone'`，实施时与「完整目录+node_modules」二选一定稿——pnpm symlink 的 rsync 处理是完整目录方案的坑）、api `dist`、ai-bid worker `dist`、packages dist、`deploy/` 全套、env 模板
- **服务器侧基础软件同样离线**：Node 24 tar.xz、nginx deb/rpm、Docker/容器镜像（KingBase、Redis、MinIO）、OCR 服务 venv（`services/ocr` 全量目录含依赖）——runbook 附「离线介质清单」章节，开发机侧 `docker save`/`apt download` 备好随包
- 分发通道待定：开发机（192.168.1.x）与 10.10.7.x 是否互通未知——runbook 写 scp 与离线介质（U盘）两种走法

### 10.2 无出站功能矩阵（Phase 1 / Phase 2）

| 依赖出站的能力 | Phase 1（无出站） | Phase 2（批复后） |
|---|---|---|
| DeepSeek（水叮当/AI 投标分析/公告摘要/AI 邀请函） | 不可用，入口隐藏或降级提示 | 填 `DEEPSEEK_API_KEY` 重启 |
| 短信验证码（供应商自注册） | 不可用（生产 SMS bypass 守卫拒绝；配合路线 C 供应商线下建档） | 配 `SMS_PROVIDER` 启用自注册 |
| SCCA 网关（U盾真盾轨） | 不可用；专家端软证书（MockUKeyAdapter，无网络）不受影响 | 填网关地址重启 |
| 在线 embedding API | 不可用（tender-review 语义审查/知识库向量降级；规则轨不受影响） | 填 `EMBEDDING_BASE_URL` 启用 |

env 模板把这些项集中成「出站批复后启用」段；验收用例 Phase 1 排除 AI 项。

### 10.3 路线 C：密钥全新生成 + 最小账号引导脚本

- `JWT_SECRET` / `KMS_SECRET` / `FIELD_ENC_SECRET` 全部**新生成**（≥32 随机，runbook 附生成命令）；无 keystore/MinIO/密钥迁移章节（空库无历史加密对象）
- **新增交付物**：`deploy/scripts/bootstrap-admin.ts`——绕过 seed 演示数据，直建最小集：集团主数据 Company + 首个 admin 账号（口令现场生成并打印一次性凭据，**不沿用 `<用户名>@2026` 演示惯例**）；后续账号走 :3005 账号管理页建档
- 空库上线后其余主数据（专家库、供应商、目录）按业务节奏经各管理端录入，或后续从开发库选择性导出（另立任务，不在本期）
