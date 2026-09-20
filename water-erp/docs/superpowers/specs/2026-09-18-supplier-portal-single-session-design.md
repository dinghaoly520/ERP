# 供应商门户（:3004）单设备登录设计

日期：2026-09-18
状态：已批准（方案一：复用 :3005 机制，纯 cookie 承载）

## 背景与问题

供应商门户（`apps/supplier-portal-next`，:3004）目前登录写 `token_supplier` cookie 后不做会话轮换，同一供应商账号可同时在多台电脑/多个浏览器在线，互不感知。

采购管理工作台（:3005）已于 2026-08-21 落地单设备登录（`User.webSessionId` + JWT `sid` + `AuthGuard` 比对 + 前端心跳/被踢遮罩，见 CLAUDE.md「:3005 单设备登录」）。本设计将该机制扩展到 supplier 命名空间。

## 目标

1. 同一供应商账号同一时间只允许一处在线；跨电脑、跨浏览器的新登录将旧会话顶下线（401 `SESSION_REPLACED`）。
2. 被踢用户看到全屏遮罩提示「该账号已在其他设备登录」，可选「反馈给管理员」（通知所有 admin）或「直接重新登录」——完整对齐 :3005 体验。
3. 存量无 sid 的供应商会话一次性强制失效重登（对齐 :3005 上线时的处理）。

## 非目标（用户已裁定）

- **同浏览器多账号 tab 级并存不做**（即不引入 `X-Supplier-Token` 头 + sessionStorage 机制）：同浏览器第二个账号登录直接以 cookie 覆盖前者，前者会话自然消亡。现状行为，无回退。
- **登录页账号密码预填不做**：供应商账号为公司级资产，往 localStorage 存密码（即便 base64 混淆）风险大于被踢后重输的不便。
- WS 长连（`use-bid-websocket`）不联动吊销（:3005 亦未处理，范围外）。
- logout 不轮换 sid（与 :3005 一致；旧 token 在重新登录轮换前理论上仍有效）。

## 机制

### 数据模型

**复用 `User.webSessionId` 单列，零 schema 迁移。** 角色与门户强绑定（`ROLE_COOKIE_PORTAL`：supplier 角色 → 且仅 → `token_supplier` 命名空间；supplier 用户不可能产生 web 会话），两列永不同时使用，故不新增 `supplierSessionId`（方案二否决理由）。

### 登录轮换（后端）

`apps/api/src/auth/auth.controller.ts` 登录端点：`cookiePortal === 'supplier'` 时与 `'web'` 一样调用会话轮换（现 `rotateWebSession` 泛化更名为 `rotatePortalSession`）：生成新 sid 写 `User.webSessionId`，签发带 `sid` 的 JWT，写 `token_supplier` cookie。无论从 :3004 直登还是 :3002 公共入口登录（均经 `portalForRole('supplier')` 解析为 `'supplier'`），统一触发——后登录者顶掉先登录者。

全库仅 `auth.controller.ts:155`（login）一处写 `token_supplier`（另一处 `res.cookie` 为 mall SSO 桥，无关），无遗漏入口。

### 守卫校验（后端）

`apps/api/src/auth/auth.guard.ts` 现有逻辑门户无关，对 supplier token 自动生效：

- JWT 带 `sid` 且 `sid !== User.webSessionId` → 401 `{ code: 'SESSION_REPLACED', error: '该账号已在其他设备登录，请重新登录' }`。
- **新增分支**：JWT 无 `sid` 且 token 来自 `token_supplier` cookie（`req.cookies.token_supplier === token`）→ 401 `SESSION_REPLACED`（存量会话强制失效，文案用「登录已失效，请重新登录」与 web 存量分支一致）。
- 其他命名空间（`token_web`/`token_bid`/`token_expert`/`token_mall`）行为不变。

### 被踢时序

```
设备A登录账号X → webSessionId=sidA，token(sidA) 写 cookie
设备B登录账号X → webSessionId=sidB，token(sidB)
设备A下一请求（业务API或15s心跳）携带 token(sidA)
  → AuthGuard: sidA ≠ sidB → 401 SESSION_REPLACED
  → 前端遮罩「该账号已在其他设备登录，是否向管理员反馈？」
     ├─ 反馈 → POST /auth/security-feedback（@Public；被踢设备 cookie 中仍是自己的旧 token，
     │         后端验签取 username → 通知所有 admin 站内信，link 指 /admin/accounts）→ 回 /login
     └─ 直接重新登录 → 回 /login
```

同浏览器第二账号登录 = cookie 覆盖，前者自然消亡（无并存）。

## 前端改动（apps/supplier-portal-next）

| 文件 | 动作 | 内容 |
|------|------|------|
| `src/lib/session-kick.ts` | 新增 | 移植 :3005：DOM 直插全屏遮罩（不经 React，任何页面状态可弹），不可关闭，20s 无操作强制回 /login。`SESSION_REPLACED` 双按钮（反馈/重登）、`ACCOUNT_FROZEN` 单按钮。类名用 :3004 已有的 `neu-card / neu-icon-well / neu-btn-group / neu-btn-primary / neu-btn-soft`（已核实 globals.css 全套存在）。反馈请求带 `X-Portal: supplier` 头，身份取 cookie 旧 token |
| `src/components/session-watchdog.tsx` | 新增 | 15s 心跳 `GET /auth/heartbeat`；仅 `document.cookie` 含 `token_supplier` 时发送；挂 `src/components/providers.tsx` |
| `src/lib/api.ts` | 修改 | `guard()` 的 401 分支：`code === 'SESSION_REPLACED'` → `showSessionReplacedOverlay(msg)`、`code === 'ACCOUNT_FROZEN'` → `showFrozenOverlay(msg)`（遮罩替代 toast+redirect，注意避免登录请求/ACCOUNT_PENDING 误触发）；其余 401 维持现状 toast+跳转兜底 |
| `src/proxy.ts` | 不动 | 被踢后 cookie 仍在，页面门禁放行，由页面内心跳/业务 401 触发遮罩（预期行为） |

冻结遮罩为顺带收益：`ACCOUNT_FROZEN` 后端行为已通用存在，本次前端一并分流。

## 边界与错误处理

- 游客页（/login、/register、/register-temporary、/rsvp）：无 cookie 不发心跳；api guard 对登录请求的 401 不弹「已过期」。
- `security-feedback` 反馈失败不阻塞回登录页（fetch catch 忽略，与 :3005 一致）。
- 心跳端点已在操作日志排除清单（:3005 时加入，路径级排除、门户无关；实现时验证 `OPERATION_LOG_EXCLUDE` 默认值确含 heartbeat）。
- admin 在账号管理修改供应商密码会轮换同一列 → 供应商会话即时吊销（无需额外改动的顺带收益）。

## 测试计划

**后端**（`apps/api`，jest）：
1. 同账号两次登录：第一次 token 访问受保护端点（`GET /auth/me`）→ 401 `SESSION_REPLACED`；第二次 token → 200。
2. 无 sid 存量 token（手工签发不带 sid 的 JWT）+ `token_supplier` cookie → 401。
3. 回归：web 命名空间互踢不受影响；mall/expert/bid 登录不轮换。

**前端**（人工验证清单，按登录/截图配方可视化留证）：
1. 双浏览器同账号互踢：后登者正常，先登者 ≤15s 出遮罩。
2. 同浏览器第二账号登录：前者被覆盖，无并存。
3. 遮罩两按钮：反馈后 admin 收站内通知；直接重登回 /login。
4. 冻结账号（admin 冻结后）存量会话出冻结遮罩。

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 会话存储 | 复用 `User.webSessionId` | 角色↔门户互斥零冲突；零迁移（新列仅买命名清晰，否决） |
| 会话注册表 | 不用 Redis | 每请求 Redis 查询 + 与 :3005 机制分叉（否决） |
| 多账号并存 | 不支持（纯 cookie） | 用户裁定：同一台电脑也不允许多个供应商端登录并存 |
| 被踢 UX | 完整复刻 :3005（含反馈管理员） | 用户选 A；端点 @Public 通用，复用近零成本 |
| 存量会话 | 强制失效重登 | 对齐 :3005 上线做法，一次性影响 |
| prefill | 不做 | 公司级账号，浏览器存密码风险 > 便利 |
