# TAB-SYNC-01 平板配对双端并存打分 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以「配对不迁移」替代 09-22 迁移制——桌面保持唯一全量会话，平板持受限令牌（仅草稿/备忘/口令等白名单写面）双端并存，草稿按逐键最新语义实时同步，复活冲突弹窗与 focus-hint。

**Architecture:** 三层：① 受限 JWT（`token_expert` 命名空间、携带桌面 sid + `scope=tablet-pairing`）+ Redis 配对登记（吊销/单台替换）；② 全局 `PairingScopeGuard` 对 scoped 请求默认拒绝（白名单+pid 绑定）；③ §4.1 草稿合并语义修正（服务端逐键取新 + 客户端三方基线判定）。闸4、单设备互踢、双槽存储、整槽覆写全部不动。

**Tech Stack:** NestJS 11 + Prisma + Redis（ioredis，注入令牌 `REDIS_CLIENT`）、Socket.IO、Next.js 16 App Router、node:test（expert-portal）、jest（api 单测）、jest e2e。

**Spec:** `docs/superpowers/specs/2026-11-12-tab-sync-01-tablet-pairing-design.md`（已批准 2026-11-12）——**执行者必须先通读 spec**；本计划只锁文件/签名/测试，语义依据全部在 spec。

## Global Constraints

- 反目标（做到即失败）：配对任何动作不得使桌面会话失效；scoped 令牌不得可达任何提交类/过程类写端点（默认拒绝制，非点名拦截制）。
- Cookie 命名空间 `token_expert` 不变；配对/全量身份仅靠 claims `scope` 区分。
- 配对 JWT：同一 `JWT_SECRET`；claims `{ sub, username, role: 'bid_expert', sid, scope: 'tablet-pairing', pid, eid, jti }`；**sign 时显式 `{ expiresIn: '12h' }`**（模块默认 7d，spec §5.1）。
- Redis 键：`expert-pairing:{jti}`（值 JSON `{userId, expertId, projectId, pairedAt, device}`，TTL 12h）、`expert-pairing:active:{eid}:{pid}` → jti（TTL 12h）。
- 闸4（`checkExpertSeatLock`）逻辑零改动；claim 端点保持 `@Public` + `@Throttle 10/min`。
- **无 Prisma schema 迁移**；`transferPhoto*` 三列复用（语义改配对留档照）。
- 端点重命名 `pairing-*`，旧 `transfer-*`/`expert-transfer` 端点**删除不留兼容**。
- 错误码（HTTP 体 `{ error, code }`）：`PAIRING_SCOPE_FORBIDDEN`(403)、`PAIRING_PROJECT_MISMATCH`(403)、`PAIRING_REVOKED`(401)。
- TS 约定：无 `esModuleInterop`；CJS 函数导出包用 `import x = require('pkg')`。
- 并行会话规则：**禁 `git add -A`**，只 add 本任务文件；提交信息 `feat(tab-sync-01):` 前缀 + `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- API 单测跑法：`pnpm --filter api test -- <pattern>`；前端验证 `pnpm --filter expert-portal exec tsc --noEmit`（main 上 lint 不可用）。

## Review Focus

1. **旧格式草稿混存**（无 per-entry `savedAt` 的条目与新格式同槽）→ 合并走槽级 `savedAt` 回退，不炸不丢键 —— Task 1 测试钉死。
2. **scoped 令牌直打 `/upload` 非留档照类目**（如 `category=bid_document`）→ 403 `PAIRING_SCOPE_FORBIDDEN` —— Task 3 测试钉死。
3. **票据 pending 期间桌面登出**（`webSessionId` 清空）→ claim 409 `TICKET_STALE`，不得签发令牌 —— Task 5 测试钉死。
4. **平板登出误杀桌面**（scoped 令牌带桌面 sid）→ logout 分流后桌面 `/auth/me` 仍 200 —— Task 4 测试钉死。
5. **同键双端再编辑序列**（平板 85→桌面 75→平板 90，spec §12.2）→ 双端最终均见 90，无静默分叉 —— Task 8 单测 + Task 12 e2e 钉死。

---

### Task 1: 服务端草稿合并语义修正（spec §4.1 服务端半）

**Files:**
- Create: `apps/api/src/expert/score-draft-merge.util.ts`
- Modify: `apps/api/src/expert/expert.service.ts:2811-2835`（`getScoreDraft` 改调 util）
- Test: `apps/api/src/expert/score-draft-merge.util.spec.ts`

**Interfaces:**
- Produces: `mergeDraftSlots(raw: unknown, device?: 'tablet' | 'desktop'): { scores: Record<string, ScoreEntry>; savedAt: number }`，`ScoreEntry = { score: number; reason: string; passed?: boolean | null; points?: Record<string, { checked: boolean; awardedScore: number }>; savedAt?: number }`。逐键取两槽中 `savedAt` 新者；条目无 `savedAt` → 回退所属槽顶层 `savedAt`；仍无（旧扁平格式）→ 保持旧扁平分支语义；相等时间戳 → `device` 侧槽优先 tiebreak。顶层 `savedAt` = 两槽 max。

- [ ] **Step 1: 写失败测试** `score-draft-merge.util.spec.ts`，用例：①双槽同键不同值不同 savedAt → 取新者（双向各测一次）；②回声无害——tablet 槽回声条目（savedAt 拷贝自原编辑时刻）vs desktop 槽更新条目 → 取 desktop；③条目无 savedAt 回退槽级；④旧扁平格式（`raw.scores` 直接存在）→ 原样返回；⑤时间戳相等 → device 槽优先；⑥顶层 savedAt = max
- [ ] **Step 2: 跑测试确认失败** `pnpm --filter api test -- score-draft-merge` → FAIL（模块不存在）
- [ ] **Step 3: 实现 `mergeDraftSlots`**（纯函数，无依赖；旧扁平分支照抄现 `getScoreDraft` 2816-2819 语义）
- [ ] **Step 4: `getScoreDraft` 改调 util**——方法体只剩：口令闸 + 启动闸 + 查 `bidExpert` + `return mergeDraftSlots(expert?.scoreDraft, device)`；原内联合并逻辑删除
- [ ] **Step 5: 跑全量相关测试** `pnpm --filter api test -- expert.service` + `score-draft-merge` → PASS（存量 spec 若断言旧「本设备优先」语义，按 spec §4.1 更新断言——旧语义是被裁定废弃的缺陷）
- [ ] **Step 6: Commit** `git add apps/api/src/expert/score-draft-merge.util.ts apps/api/src/expert/score-draft-merge.util.spec.ts apps/api/src/expert/expert.service.ts` → `feat(tab-sync-01): 草稿合并改逐键取最新（per-entry savedAt）——修复同键双端再编辑静默分叉`

### Task 2: 配对登记 Redis 服务 + 受限令牌签发

**Files:**
- Create: `apps/api/src/auth/expert-pairing.registry.ts`、`apps/api/src/auth/expert-pairing.module.ts`
- Modify: `apps/api/src/auth/auth.module.ts`（imports ExpertPairingModule）、`apps/api/src/expert/expert.module.ts`、`apps/api/src/bid/bid.module.ts`（同）
- Test: `apps/api/src/auth/expert-pairing.registry.spec.ts`

**Interfaces:**
- Produces: `@Injectable() ExpertPairingRegistry`（构造注入 `@Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis`，与 auth.service.ts:39 同款）：
  - `register(args: { userId: string; expertId: string; projectId: string; device: { uaSummary: string; ip?: string | null } }): Promise<{ pairingId: string; replaced: string | null }>`——`pairingId = randomUUID()`；读 `active:{eid}:{pid}` 旧 jti（有则 DEL 旧 `expert-pairing:{旧jti}`，`replaced=旧jti`）；SET 两键 TTL `12*3600`；Redis 缺失 throw `ServiceUnavailableException`
  - `isAlive(pairingId: string, userId: string): Promise<boolean>`——GET + JSON 比对 userId
  - `getActive(expertId: string, projectId: string): Promise<{ pairingId: string; device: { uaSummary: string } | null; pairedAt: number } | null>`
  - `revoke(pairingId: string): Promise<{ userId: string; expertId: string; projectId: string } | null>`（返回被删条目供监督日志；无则 null）、`revokeForUser(userId: string): Promise<void>`（后者 SCAN `expert-pairing:*` 值比对 userId 删——低频调用，SCAN 可接受）
- Produces: `ExpertPairingModule`（providers/exports registry）
- 令牌签发留在 Task 5 的 claim 改造里（claims 见 Global Constraints）。

- [ ] **Step 1: 写失败测试**——用 Map 内存 fake Redis（get/set/del/scan/expire 按 ioredis 子集）覆盖：register 新建 / register 替换（旧 jti 被删、active 键指向新） / isAlive 不匹配 userId → false / revoke 后 isAlive false / TTL 传参 12h
- [ ] **Step 2: 跑测试确认失败** `pnpm --filter api test -- expert-pairing.registry` → FAIL
- [ ] **Step 3: 实现 registry + module**；三 module imports 接线
- [ ] **Step 4: 跑测试 PASS**
- [ ] **Step 5: Commit** `feat(tab-sync-01): 配对登记 Redis 服务（单台替换/吊销/存活查询）`

### Task 3: PairingScopeGuard（白名单默认拒绝 + pid 绑定）

**Files:**
- Create: `apps/api/src/auth/tablet-pairing.scope.ts`（白名单数据）、`apps/api/src/auth/pairing-scope.guard.ts`
- Modify: `apps/api/src/app.module.ts:131-134`（APP_GUARD 链尾追加 `{ provide: APP_GUARD, useClass: PairingScopeGuard }`）
- Test: `apps/api/src/auth/pairing-scope.guard.spec.ts`

**Interfaces:**
- Consumes: `req.pairingScope = { projectId: string; expertId: string; pairingId: string }`（Task 4 挂载；本任务先按此类型写守卫，spec 用手挂字段测）
- Produces: `PAIRING_ALLOWED: ReadonlyArray<{ method: string; path: RegExp; uploadCategory?: string }>`（spec §6 表逐条翻译：score-draft POST、memos 全 CRUD+ink、pairing-photo-status/pairing-photo、`POST /upload`（`uploadCategory: 'expert_signin_photo'`，比对 `req.query.category`）、focus-hint GET、room-code/verify POST、clarification-docs download POST、logout POST、heartbeat/me GET、`GET /expert/projects*`、profile/statistics/tasks GET）；`PairingScopeGuard implements CanActivate`——无 `pairingScope` 直接放行；路由匹配（方法+`req.path` 去 `/api` 前缀）命中失败 → 403 `PAIRING_SCOPE_FORBIDDEN`「平板配对身份无权执行此操作，请在桌面端操作」；`/expert/projects/:projectId` 路径捕获 projectId ≠ `pairingScope.projectId` → 403 `PAIRING_PROJECT_MISMATCH`「平板仅可访问已配对项目」

- [ ] **Step 1: 写失败测试**——手挂 `req.pairingScope` 构造 ExecutionContext：①白名单各端点放行（抽 score-draft/memos/upload/heartbeat 代表）②`POST /expert/projects/x/scores` → 403 code 断言 ③upload 类目不匹配 → 403 ④pid 不匹配 GET → `PAIRING_PROJECT_MISMATCH` ⑤跨项目端点（/auth/me、/expert/profile）放行 ⑥无 pairingScope 的普通请求放行
- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现守卫 + 白名单 + app.module 注册**
- [ ] **Step 4: PASS**（并跑 `pnpm --filter api test` 全量确认无守卫误伤存量）
- [ ] **Step 5: Commit** `feat(tab-sync-01): PairingScopeGuard——scoped 请求默认拒绝+pid 绑定`

### Task 4: AuthGuard 集成 + logout 分流 + 登出卫生清理

**Files:**
- Modify: `apps/api/src/auth/auth.guard.ts:90-91` 附近（全部既有校验通过后：`payload.scope === 'tablet-pairing'` → `registry.isAlive(payload.jti, payload.sub)` false 则 401 `{ error: '配对已解除或过期，请在桌面端重新生成配对码', code: 'PAIRING_REVOKED' }`；通过则挂 `req.pairingScope`）；`apps/api/src/auth/auth.module.ts`（AuthGuard 所在模块提供 registry——AuthGuard 经 APP_GUARD 全局解析，依赖须在其宿主 module scope，参照 jwt-module-not-dead-in-audit-user-settings 教训）；`apps/api/src/auth/auth.controller.ts:300-334`（logout：`revokeToken` verify 后 `payload.scope === 'tablet-pairing'` → `registry.revoke(jti)` 返回条目写监督日志「平板解除配对（平板端登出）」+ clearCookie，**不碰 webSessionId**；全量分支在原 shouldRevokeSession 清理后追加 `registry.revokeForUser(userId)`）
- Test: `apps/api/src/auth/pairing-integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 `ExpertPairingRegistry`。
- Produces: `req.pairingScope`（Task 3/5/7 消费）；错误码 `PAIRING_REVOKED`。

- [ ] **Step 1: 写失败测试**——①scoped 令牌 + registry alive → 放行且 `req.pairingScope` 三字段正确 ②registry dead → 401 PAIRING_REVOKED ③logout scoped 分支：webSessionId 不被写、revoke 被调、cookie 清 ④logout 全量分支追加 revokeForUser（原 sid 清理行为不变）
- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现**（AuthGuard 注入 registry 走构造器可选注入，同 redis 模式）
- [ ] **Step 4: PASS + 全量单测** `pnpm --filter api test`（AuthGuard 是全局面——存量大量 spec 走它，必须全绿）
- [ ] **Step 5: Commit** `feat(tab-sync-01): AuthGuard 配对令牌识别+登出分流（平板登出不误杀桌面）`

### Task 5: 票据与端点改造（pairing 命名 + claim 新语义 + GET/DELETE pairing + photo 重命名 + 闸4 文案）

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`issueTransferTicket`→`issuePairingTicket`——逻辑原样，监督日志文案「工位迁移码签发」→「平板配对码签发」；`recordTransferPhoto`/`transferPhotoStatus`→`recordPairingPhoto`/`pairingPhotoStatus`——逻辑原样；新增 `getPairing(userId, projectId)`（调 registry.getActive + 专家归属校验）与 `unpair(userId, projectId, reason)`（revoke + 监督日志））
- Modify: `apps/api/src/expert/expert.controller.ts:64-97`（路由：`projects/:projectId/pairing-ticket`、`pairing-ticket/:ticketId/status`、`pairing-photo-status`、`pairing-photo`；新增 `GET projects/:projectId/pairing`、`DELETE projects/:projectId/pairing`（全量会话专用，无白名单条目））
- Modify: `apps/api/src/auth/auth.service.ts:656-762`（`claimExpertTransfer*`→`claimExpertPairing*`：票据锁/烧票/sid 绑定/临时账号复核/留档照 pending 全保留；删 `rotatePortalSession` 调用，改 `registry.register(...)` + `this.jwt.sign(claims, { expiresIn: '12h' })`；监督日志「工位迁移」→「平板配对成功」含设备摘要与「桌面会话不受影响」）；`apps/api/src/auth/auth.controller.ts:246`（路由 `expert-pairing/claim`；闸4 文案 `auth.controller.ts:209` 增「评标期间请使用桌面端『配对打分平板』二维码」）
- Delete: 旧 `expert-transfer/claim` 路由（同函数改造即删旧名）
- Test: `apps/api/src/auth/expert-pairing-claim.spec.ts`、`apps/api/src/expert/expert.service.spec.ts`（迁移票相关存量用例改名跟进）

**Interfaces:**
- Consumes: Task 2 registry。
- Produces: `POST /api/expert/projects/:id/pairing-ticket` → `{ ticket, ticketId, expiresInSeconds: 90 }`；`POST /api/auth/expert-pairing/claim` → `{ access_token, role, username, projectId, photoRequired }`（形状与旧 claim 一致——pair 页改动最小化）；`GET /api/expert/projects/:id/pairing` → `{ device: { uaSummary: string; ip?: string | null } | null; pairedAt: number | null }`；`DELETE /api/expert/projects/:id/pairing` → `{ ok: true }`。

- [ ] **Step 1: 写失败测试**（claim spec，mock registry+jwt+prisma）：①成功路径——`user.webSessionId` **未被写入**（反目标断言）、registry.register 被调、token claims 含 scope/pid/eid/jti/sid、sign 传 `expiresIn: '12h'` ②密码错 3 次烧票 ③票据 sid ≠ 当前 webSessionId → 409 TICKET_STALE ④并发锁（第二个并发 claim → CLAIM_IN_PROGRESS）⑤`getPairing`/`unpair` 非本项目专家 403
- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现全部重命名与改造**（跑 `npx tsx scripts/list-uncovered-routes.ts` 确认新路由守卫覆盖）
- [ ] **Step 4: PASS + 全量单测**
- [ ] **Step 5: Commit** `feat(tab-sync-01): 配对票据/claim/查询/解绑端点——不轮换会话签发受限令牌`

### Task 6: WS 握手 connect 时校验（sid 一致 + 配对登记存活）

**Files:**
- Modify: `apps/api/src/bid/bid.gateway.ts:184-215`（`handleConnection` 在 role/userId 校验后追加：payload 带 `sid` → 查 `prisma.user.findUnique({select:{webSessionId}})`，`payload.sid !== user.webSessionId` → 拒连日志+disconnect；payload 带 `scope: 'tablet-pairing'` → `registry.isAlive(jti, sub)` false → 拒连）；`apps/api/src/bid/bid.module.ts`（imports ExpertPairingModule）
- Test: `apps/api/src/bid/bid.gateway.pairing.spec.ts`

**Interfaces:**
- Consumes: Task 2 registry；gateway 已注入 `JwtService`/`PrismaService`（bid.gateway.ts:177-180），新增注入 registry。

- [ ] **Step 1: 写失败测试**——mock socket.handshake（cookie token）+ jwt.verifyAsync 返回构造 payload：①sid 失配 → disconnect(true) ②scoped + dead registry → disconnect ③全匹配 → 连接建立
- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现**（拒连走既有 `this.logger.warn + socket.disconnect(true)` 模式）
- [ ] **Step 4: PASS + 全量单测**
- [ ] **Step 5: Commit** `feat(tab-sync-01): WS 握手补 sid 一致性与配对存活校验（连带修复登出后 socket 重连续命存量缺口）`

### Task 7: 杂项收口（oplog 排除 / score-draft device 强制 / listProjects 过滤）

**Files:**
- Modify: `apps/api/src/operation-log/operation-log.filter.ts:13-35`（DEFAULT_EXCLUDE_PATHS 追加 `{ method: 'POST', path: /^\/api\/expert\/projects\/[^/]+\/score-draft$/ }`，注释注明双端防抖自动保存噪音、真审计在 BidScoreRecordHistory）
- Modify: `apps/api/src/expert/expert.controller.ts`（`saveScoreDraft`/`getScoreDraft`/`listProjects` 从 `@Req()` 取 `pairingScope` 传 service；`saveScoreDraft` device 参数在 pairingScope 存在时强制 `'tablet'`）
- Modify: `apps/api/src/expert/expert.service.ts`（`saveScoreDraft`/`getScoreDraft`/`listProjects` 增可选参 `pairingScope?: { projectId: string }`；listProjects 过滤 `p.project.id === pairingScope.projectId`）
- Test: `apps/api/src/expert/expert.service.spec.ts` 追加用例

- [ ] **Step 1: 写失败测试**——①saveScoreDraft 传 pairingScope+device='desktop' → 落库仍是 tablet 槽 ②listProjects 传 pairingScope → 仅配对项目 ③oplog filter 对 score-draft POST isExcluded=true
- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: PASS + 全量单测**
- [ ] **Step 5: Commit** `feat(tab-sync-01): 平板槽强制/项目过滤/操作日志排除收口`

### Task 8: 草稿三方合并客户端 util（spec §4.1 客户端半）

**Files:**
- Create: `apps/expert-portal/src/lib/draft-merge.ts`、`apps/expert-portal/src/lib/__tests__/draft-merge.test.ts`
- Run: `cd apps/expert-portal && pnpm test`（package.json 已配 `node --test src/lib/__tests__/*.test.ts`）

**Interfaces:**
- Produces: `threeWayMerge(local: Record<string, ScoreEntry>, baseline: Record<string, ScoreEntry>, remote: Record<string, ScoreEntry>): { next: Record<string, ScoreEntry>; conflicts: Array<{ key: string; local: ScoreEntry; remote: ScoreEntry }>; baseline: Record<string, ScoreEntry> }`——逐键（remote 键集 ∪ local 键集）：本地==基线（或本地无此键）→ 接受 remote；remote==基线（或 remote 无此键）→ 保留 local；双端都偏离 → conflicts（next 保留 local）。返回新 baseline = remote 接受后的快照。`ScoreEntry` 形状同 Task 1（含 `savedAt?: number`）。**纯函数**，双页共用。

- [ ] **Step 1: 写失败测试**——①仅远端改 → 接受 ②仅本地改 → 保留 ③双端并发改同键 → conflict + next 保留 local ④spec §12.2 序列（85→75→90 双端各自视角）终态 90 无冲突 ⑤键集不对称（local 独有/remote 独有）
- [ ] **Step 2: 确认失败** `pnpm --filter expert-portal test` → FAIL
- [ ] **Step 3: 实现**（deepEqual 用 `JSON.stringify` 稳定比较即可——条目字段顺序由打点处控制）
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(tab-sync-01): 草稿三方合并纯函数（last-synced 基线判定）`

### Task 9: 平板 pair 页 + proxy + 落地页

**Files:**
- Create: `apps/expert-portal/src/app/(pair)/tablet/pair/page.tsx`（自 `(claim)/tablet/claim/page.tsx` 迁移：调 `POST /api/auth/expert-pairing/claim`（走 `/api` 代理同现状）、文案「迁移」→「配对」、成功态文案「已与桌面配对，桌面会话不受影响」；密码/留档照/豁免轮询 UI 原样，端点改 `pairing-photo*`）
- Delete: `apps/expert-portal/src/app/(claim)/` 整目录
- Modify: `apps/expert-portal/src/proxy.ts:109`（`pathname === '/tablet/claim'` → `'/tablet/pair'`，注释同步）；`(tablet)/tablet/page.tsx:58` 横幅改「已与桌面配对 · 评分实时同步，请在桌面端审阅并提交」

- [ ] **Step 1: 迁移与改造页面**（无独立测试——由 Task 12 e2e/浏览器覆盖）
- [ ] **Step 2: 类型验证** `pnpm --filter expert-portal exec tsc --noEmit` → 无错；全局 grep `tablet/claim` 确认零残留（`rg -n "tablet/claim" apps/expert-portal/src`）
- [ ] **Step 3: Commit** `feat(tab-sync-01): claim 页改配对页（/tablet/pair）+proxy 特判与横幅文案`

### Task 10: 桌面端 evaluate 页改造

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`——①`openTransferDialog`→`openPairingDialog`：调 `pairing-ticket`，QR 弹窗轮询 `pairing-ticket/:id/status`，`paired` 态显示设备摘要+配对时间+「解除配对」（`DELETE pairing`）；②已配对常驻徽章（进打分步拉 `GET pairing`）；③`onDraftSaved`：加 `d.expertId === project.myExpertRecord.id` 过滤 + 拉取后改 `threeWayMerge`（baseline ref map 持久于组件生命周期），新增键静默并入、conflicts 进现有横幅/`SyncConflictModal`；④编辑处理函数（分数/通过/得分点/reason 变更入口）给条目打 `savedAt: Date.now()`；⑤删 `markTransferClaimed` 引用与 effect
- Delete: `apps/expert-portal/src/lib/transfer-claimed-flag.ts`

- [ ] **Step 1: 改造**（UI 交互验证归 Task 12；本步只锁编译与逻辑落点）
- [ ] **Step 2: 类型验证** `pnpm --filter expert-portal exec tsc --noEmit` → 无错；`rg -n "transfer-claimed|markTransferClaimed" apps/expert-portal/src` 零残留
- [ ] **Step 3: Commit** `feat(tab-sync-01): 桌面端配对弹窗/徽章/解绑+草稿三方合并接入`

### Task 11: 平板端 evaluate 页 + api 客户端分流

**Files:**
- Modify: `apps/expert-portal/src/app/(tablet)/tablet/evaluate/[id]/page.tsx`——①`onDraftSaved` 同桌面（expertId 过滤+threeWayMerge）；②编辑入口打 `savedAt`；③页头注释与横幅真实语义；④口令轮换 toast 文案（现「请向主持人获取新口令」→「请输入新口令重新验证」——verify 已白名单）
- Modify: `apps/expert-portal/src/lib/api.ts:24-25`——on401 增 `PAIRING_REVOKED` 分支：遮罩「配对已解除或过期，请在桌面端重新生成配对码」+ 回登录页（复用 session-kick 遮罩骨架，文案独立）；`SESSION_REPLACED` 分支保留

- [ ] **Step 1: 改造**
- [ ] **Step 2: 类型验证** tsc 无错
- [ ] **Step 3: Commit** `feat(tab-sync-01): 平板端草稿三方合并/PAIRING_REVOKED 分流/文案真实化`

### Task 12: 主持端配对可见性（spec §9.3 监督可见性）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:3417-3439`（专家核验聚合处：逐专家追加 `tabletPaired: { device: { uaSummary } | null; pairedAt: number | null }`——调 `registry.getActive(expertId, projectId)`；BidModule 已在 Task 6 imports ExpertPairingModule）
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（「当前在线设备」行扩展：桌面会话快照行 + `tabletPaired` 时第二行「平板（配对）· 设备摘要 · 配对时间」）

**Interfaces:**
- Consumes: Task 2 `ExpertPairingRegistry.getActive`。

- [ ] **Step 1: 实现**（只读聚合+展示，无新端点；`pnpm --filter api test -- bid.service` 存量 spec 回归）
- [ ] **Step 2: 类型验证** `pnpm --filter bid-portal exec tsc --noEmit`
- [ ] **Step 3: Commit** `feat(tab-sync-01): 主持端核验矩阵显示平板配对行`

### Task 13: e2e 套件 + 双 context 浏览器验收 + 文档收口

**Files:**
- Create: `apps/api/test/tab-sync-01-pairing.e2e-spec.ts`（沿用 `test/auth.e2e-spec.ts` 的种子+cookie 模式；桌面侧用种子专家登录，平板侧直接调 claim 拿 token 走 `X-Portal: expert` cookie）
- Modify: `CLAUDE.md`（专家门户章节「扫码工位迁移」段改配对制口径——spec §13）；`docs/bugs/2026-11-11-yuanguoyu/票修队列.md`（TAB-SYNC-01 行状态推进）

**Interfaces:**
- Consumes: 全部前序端点。e2e 覆盖 spec §12 全 13 项（含 Review Focus 3/4/5）。

- [ ] **Step 1: 写 e2e**——按 spec §12.1-13 逐条（同键再编辑回归为关键项：两「设备」各持 cookie/独立 request 交替写读 score-draft）
- [ ] **Step 2: 跑 e2e** `pnpm --filter api test:e2e -- tab-sync-01` → 全 PASS（本地隔离环境配方见 memory `local-e2e-isolated-harness-seed-gotchas`）
- [ ] **Step 3: 浏览器双 context 验收**——chrome-devtools 两个独立 context（桌面 1280 视口 + 平板仿真 820 视口）：配对→平板改分→桌面冲突弹窗；focus-hint 定位闪烁；解绑→平板 15s 内 PAIRING_REVOKED 遮罩；截图留档 `docs/bugs/2026-11-11-yuanguoyu/evidence/tab-sync-01/`
- [ ] **Step 4: 文档收口**（CLAUDE.md 段落 + 票修队列行）
- [ ] **Step 5: 全量回归** `pnpm --filter api test` + `pnpm --filter api test:e2e` 全绿；`pnpm dev:kill && pnpm dev` 起 10 端口冒烟
- [ ] **Step 6: Commit** `feat(tab-sync-01): e2e 13 项+浏览器验收留痕+文档收口`
