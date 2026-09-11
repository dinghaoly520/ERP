# 前后端架构审计报告（2026-08）

> 审计日期：2026-08-14
> 范围：`water-erp/` monorepo（NestJS API + 8 前端门户 + 3 共享包）
> 方法：三个并行探索 agent 分别梳理后端、前端、横切面，产出一线证据（文件:行号）；高危论断由主会话抽查复核。

---

## 总体结论

**骨架科学、纪律腐化。** 架构大方向是对的——按受众切门户、单 API、进程边界清晰、安全纵深到位，放在招投标 ERP 里是成熟设计。但正被三类系统性债务侵蚀：

1. **复用机制空转**：共享包建了不用，同一代码复制 5 份；
2. **授权默认值方向反了**：默认放行 + 跨命名空间令牌回退；
3. **聚合根失守**：万行上帝服务 + 模块图撒谎。

评分：架构骨架约 8/10，工程纪律约 5/10。

---

## 一、设计正确的地方（应该保留）

1. **门户按物理场景切分是对的。** 8 个门户对应 8 类"不同的人在不同地方做的事"——采购办（:3005）、开标现场（:3007）、供应商（:3004）、专家（:3006）、公众（:3002）。分工 v3 的阶段流转（按时开标 :3005 → 启动评标 :3007 → 完整归档 :3005）说明领域边界想清楚了。
2. **状态机设计正确。** `apps/api/src/bid/bid-state.ts` 的单向棘轮 + 允许跳步 + `FOR UPDATE` 行锁幂等 + 闸门下沉到端点业务前置，是处理并发流转的正确姿势。
3. **进程边界正确。** AI 分析独立 worker 进程、OCR 独立微服务、BullMQ enqueue/consume 分离——CPU/LLM 密集任务未拖垮 API。
4. **安全纵深到位。** 信封加密（KMS 密钥封口投标文件）、"分数永不出现在事件载荷"铁律（`packages/shared/src/bid-events.ts`）、生产 JWT 密钥启动守卫、pgbouncer / OperationLog 分区 / 备份。
5. **`@water-erp/shared` 承载跨端语义的方向正确。** 状态标签、BID_EVENT 常量、颜色映射统一从 shared 出，四端引用。

---

## 二、主要问题（按严重度）

### A. 后端：聚合根失守 + 模块图失真【高】

| 问题 | 证据 |
|---|---|
| 上帝服务 | `apps/api/src/bid/bid.service.ts` **5905 行 / 144 个 async 方法**；`project-management.service.ts` **7211 行**（混 docx 生成、zip 解压、文件缓存、预算估算、AI 分析）；`bid.controller.ts` 单 controller **102 个端点** |
| 隐藏跨域耦合 | `expert.service.ts:9-23` import BidGateway/ClarificationAiService 等 7 个跨模块符号；反向 `bid.service.ts:26-28` import `../expert/expert.util`——**双向 service 级耦合，bid.module 未声明对 ExpertModule 的依赖**，模块图与真实依赖不一致 |
| 依赖不可见 | 6 个 `@Global` 模块（prisma/redis/storage/local-ai/audit/operation-log）+ 56 个 service 直注 PrismaService、25 个直注 LlmService；`ai-bid-analysis.module.ts:3` 注释明言"均 @Global，无需 import" |

互相印证：Prisma schema **116 个模型 / 2745 行**单一文件，User 挂 17 条 relation。聚合根未划分清楚，才会长出万行 service。

### B. 鉴权与安全【高】

1. **RolesGuard 默认放行**（`apps/api/src/common/guards/roles.guard.ts:23-26`，已复核）："无 @Roles = 放行"。结合全局 AuthGuard 的语义即：**任何已登录用户（含 supplier 角色）可访问 13 个无角色声明的 controller**（progress / upload / badge / budget / chat / dashboard / notification / user-settings / alerts / audit / tender-history / work-arrangements / app）。授权应默认拒绝，方向反了。
2. **WS 跨命名空间令牌回退**（`apps/api/src/bid/bid.gateway.ts:71-82`，已复核）：供应商端口 socket 在 `token_supplier` 缺失时**回退用 `token_web`（主持人令牌）**。localhost 下所有 cookie 跨端口共享，供应商浏览器残留 token_web 时其 socket 会被识别为主持人角色（之后虽有 join:project 房间隔离兜底，但纵深防御失效）。叠加握手**软鉴权**（verify 失败不拒绝连接，`bid.gateway.ts:108-125`）与 `cors: { origin: true }`，风险偏高。
3. **JWT 不绑定门户**：载荷仅 `{sub, username, role}`（`auth.service.ts:143-146`），任一门户的合法 token 可打所有门户 API，门户隔离全靠客户端可控的 `X-Portal` 头。7 天有效期无 refresh token，撤销靠每请求查 `isActive`。
4. **生产代码硬编码开发者局域网 IP**（已复核）：`apps/public-portal/src/app/home-client.tsx:220-221` 写死 `http://192.168.1.109:3004/:3005`——换环境即断且泄露内网拓扑。
5. **守卫体系三轨并存**：AuthGuard 全局注册后又 controller 级重复挂载 **53 次**；`auth/admin.guard.ts` 重新实现一遍 AuthGuard 的 JWT 校验（仅 2 处使用）；`supplier/procurement.guard.ts:22` 硬编码角色集合，与 @Roles 是两套授权机制；JwtModule 在 auth/audit/operation-log 三处重复注册。

### C. 前端：复用机制空转【高】

1. **无共享 API 客户端**：`fetchApi` 封装复制 5 份（web `src/lib/api.ts` / bid-portal / expert-portal / public-portal / assistant），**mall 完全没有封装**、每处手写 `X-Portal` 头裸 fetch（如 `page.tsx:279-320`）；web 内部还有 10 处绕开封装的裸 fetch。全仓唯一带拦截器的客户端是 supplier-portal 的 axios（因它是 Vue）。
2. **`@water-erp/ui` 是死包**：3 个 app 声明依赖，**全仓 0 条真实 import**。web 本地 workbench 组件（metric-card / status-badge / section-card…）是 ui 包的近拷贝，`apps/web-erp-old` 存第三份拷贝。
3. **门户外壳五重实现**：登录页 5 份（web 370 行 / expert 199 / mall 160 / public 67 / supplier Vue 426）、app-shell 3 份、proxy.ts 4 份、use-bid-websocket 3 份（React×2 + Vue×1，`web/src/hooks/use-bid-websocket.ts:5-7` 头注释自认"保持同步"——手工同步必然漂移）。
4. **设计系统三份 CSS**：`apps/web/src/app/globals.css` **10,867 行**、public 2,963 行、supplier `cgzxui.css`（手工 Vue 移植）；`packages/shared/src/design-tokens.css` 无人引用是死文件。
5. **数据层缺失**：React Query 在 web 的 package.json 声明但 0 处使用（死依赖）；全部 useEffect+useState 手写取数，无缓存/重试/去抖统一策略。
6. **web 过载**：294 个文件 / **75,059 行**，是第二名 supplier-portal（13,305 行）的 5.6 倍。
7. **bigscreen 全面脱钩**：核心是 151KB 单文件 HTML 经 `readFileSync` 原样吐出（`apps/bigscreen/src/app/route.ts:4-10`），0 共享包依赖、端口双份维护、视觉体系独立。

### D. 一致性 / 配置漂移【中】

- **约 20 处端口/URL 硬编码绕过 `packages/config`**：SSO 白名单 `:3003`（`auth.controller.ts:187,193`）、7 个 next/vite config 代理 `:4001`、`ai.service.ts:297` env 名 `PUBLIC_PORTAL_URL` 却兜底 `:3004`（供应商端口，**配置错位**）、`main.ts:136` `PORT||4001`、web/mall proxy 兜底 `:4001`。
- **`ROLE_PORTAL` 双定义同名不同义**：`packages/config/src/urls.ts:24-30`（应用门户：admin→bid）vs API `auth/portal-cookie.ts:11-19`（cookie 命名空间：admin→web）。
- **Redis 双配置轨**：BullMQ 读 `REDIS_URL`，`redis.module.ts:9-13` 读 `REDIS_HOST/PORT`，可能指向不同实例。
- **`FileAsset.category` 自由字符串**：Swagger 列 5 类（`upload.controller.ts:36`），实际代码 12+ 个值，无枚举约束。
- **状态机唯一裸重置旁路**：删公告直接写 stage=DOWNLOAD（`announcement.service.ts:334-396`，有完整级联清理、刻意为之）；`packages/shared/src/types.ts:10` 的 `BidStage` 缺 `ABORTED`，前后端类型已漂移。
- **CLAUDE.md 与代码漂移**：模块表仍写"LLM 调用未收口"，实测 fetch 直连已全部收口到 local-ai。

### E. 工程化【中-低】

- `apps/api/prisma/seed.ts` 全表 TRUNCATE 111 张表**无确认闸门**，文件头自述发生过一次误清数据事故（seed.ts:17-19）；且 seed 依赖 MinIO / python / LLM 等外部副作用。
- ValidationPipe 未开 `forbidNonWhitelisted`（`main.ts:50`），8 处 `@Body() xxx: any`（`ai.controller.ts:137-158` 等），12 个 controller 无任何 DTO import。

---

## 三、改进路线

**P0 — 安全（建议立即）：**

1. RolesGuard 改**默认拒绝**，给 13 个无声明 controller 显式补 `@Roles` 或 `@Public`
2. WS 握手**去掉跨命名空间 cookie 回退**（严格按门户取对应 cookie）、verify 失败拒绝连接、Origin 白名单替代 `origin: true`
3. 删除 LAN IP 硬编码，改走 `portalURL()`

**P1 — 结构：**

4. 按聚合根拆 `bid.service` / `project-management.service`；把 expert↔bid 双向依赖显式化（提取 shared kernel，或至少让模块声明诚实）
5. 新建 `@water-erp/client`（fetch 封装 + 401 处理 + 类型），6 个门户接入；要么真正用起 `@water-erp/ui`，要么删掉它
6. 登录页/外壳收敛为一套布局包（cgzxui 已覆盖 web/public，可上移）

**P2 — 一致性：**

7. 端口/URL 全量收敛到 `packages/config`，统一 ROLE_PORTAL 语义
8. JWT 绑定门户 + refresh token
9. React Query 落地（web 先行）
10. bigscreen 收编进 monorepo 约定

---

## 附录：主会话已复核的关键证据

| 论断 | 证据 | 复核结果 |
|---|---|---|
| 生产代码硬编码局域网 IP | `apps/public-portal/src/app/home-client.tsx:220-221` | ✅ 属实 |
| 上帝文件行数 | `bid.service.ts` 5905 行、`project-management.service.ts` 7211 行、web `globals.css` 10,867 行 | ✅ 属实 |
| WS 跨命名空间 cookie 回退链 | `bid.gateway.ts:71-82`：supplier 端口回退 `token_supplier → token_web → token` | ✅ 属实 |
| RolesGuard 默认放行语义 | `roles.guard.ts:23-26`："No @Roles decorator means public access" | ✅ 属实 |
