# 专家门户登录页 · 双角色登录（专家 / 管理员）

- **日期**：2026-06-13
- **状态**：已确认，待实现
- **涉及门户**：expert-portal（:3005）
- **改动规模**：单文件前端改动，后端零改动

## 1. 背景

公众门户首页（`water-erp/apps/public-portal/src/app/page.tsx`）"快捷入口"中的"在线开评标系统"卡片链接到 `http://localhost:3005/login?forceLogin=1`，即专家门户登录页（`water-erp/apps/expert-portal/src/app/login/page.tsx`）。

该登录页目前只有"专家登录"一种形态，且 `handleLogin` 硬性拒绝非专家角色：

```ts
if (me.role !== 'bid_expert') { toast.error('非专家账户，请使用专家账号登录'); setLoading(false); return; }
```

**需求**：在该页增加"管理员登录"切换 Tab，使同一个登录页既能进专家工作台，也能进管理后台（web 门户）。

## 2. 目标

- 在专家门户登录页表单卡片上方增加 Tab 切换：`[专家登录] [管理员登录]`。
- **专家 Tab**：保持现状（登录 `bid_expert` 后进入专家工作台 `/`）。
- **管理员 Tab**：登录 `admin / bid_host / procurement_staff` 后跳转 web 门户 `/dashboard`。
- 不改后端，不改 `packages/config` / `packages/shared`。

## 3. 关键事实（已验证）

1. **后端已天然支持**。登录 cookie 按角色命名（`water-erp/apps/api/src/auth/portal-cookie.ts`）：web 端角色 → `token_web`，`bid_expert` → `token_expert`。浏览器 cookie 在 `localhost` 各端口间共享（不按端口隔离）。因此管理员在专家门户登录后浏览器拿到 `token_web`，跳到 `:3004` 时 `web/src/proxy.ts` 读 `token_web` 验证通过 → 放行进 `/dashboard`。
2. **role 必须从登录响应读，不能依赖 `/auth/me`**。`tokenFromRequest` 按 `X-Portal` / 来源端口决定读哪个 cookie；本页发 `X-Portal: expert`，`/auth/me` 会读 `token_expert`。专家登录设的是 `token_expert`，无碍；但**管理员登录设的是 `token_web`**，`/auth/me` 读 `token_expert` 读不到 → 失败。而 `POST /auth/login` 的响应体已返回 `{ access_token, role }`，直接用响应里的 `role` 即可（既修坑又省一次请求）。
3. 跨端口跳转（`:3005` → `:3004`）必须用硬跳转 `window.location.href`，不能用 SPA `router.push`。
4. `sameSite: 'lax'` 的 cookie 在顶层硬跳转时会随请求携带，`web/src/proxy.ts` 能读到。

## 4. 设计

### 4.1 改动范围

仅一个文件：`water-erp/apps/expert-portal/src/app/login/page.tsx`。

### 4.2 UI（方案 A：只换右侧卡片）

- 卡片标题区上方加一行 Tab：`[专家登录] [管理员登录]`，沿用紫色主题，选中态实色底。
- 左侧"在线开评标系统"大标题、紫色主视觉、标签（独立评审 / 智能辅助 / 过程留痕）**完全不变**。
- 随 Tab 切换的卡片内容：

| | 专家登录 | 管理员登录 |
|---|---|---|
| 卡片标题 | 专家登录 | 管理员登录 |
| 副标题 | 进入在线开评标工作台 | 进入管理后台 |
| 账号 placeholder | 请输入专家账户 | 请输入管理员账户 |
| 默认账号提示 | `wangjg / wangjg@2026` | `caigou / caigou@2026 · lizhuren / lizhuren@2026` |
| 提交按钮文案 | 进入开评标系统 | 进入管理后台 |

- 默认停在"专家登录"Tab；切换 Tab 时把账号/密码重置为该 Tab 的默认值（demo 便利，行为可预测）。

### 4.3 状态与行为

新增 `const [tab, setTab] = useState<'expert' | 'admin'>('expert')`。

`handleLogin` 从登录响应直接读 `role`（去掉原 `/auth/me` 调用），按 Tab + role 分支：

```ts
const res = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Portal': 'expert' },
  credentials: 'include',
  body: JSON.stringify({ username: form.username, password: form.password }),
});
if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error || '登录失败'); }
const { role } = await res.json();

if (tab === 'expert') {
  if (role === 'bid_expert') { toast.success('登录成功'); router.push('/'); }
  else { toast.error('非专家账户，请使用专家账号登录'); }
} else { // admin
  if (['admin', 'bid_host', 'procurement_staff'].includes(role)) {
    window.location.href = landingURL(role); // → http://localhost:3004/dashboard
  } else {
    toast.error('请使用管理员账号登录');
  }
}
```

- 保留现有 `forceLogin=1` 登出逻辑与 `X-Portal: 'expert'` 头（cookie 按角色命名，不受影响）。
- `landingURL` 来自 `@water-erp/config`（已有，无需改动该包）。

### 4.4 边界与不变量

- 管理员登录**不产生** `token_expert`，与专家会话互不污染；反之亦然。
- 异常沿用现有 `try/catch + toast`。
- 两个 Tab 互不串角色：管理员 Tab 拒绝非 web 角色；专家 Tab 拒绝非 `bid_expert`。

## 5. 非目标（YAGNI）

- 不做整页换肤（左侧主视觉不动）。
- 不抽 shared 跳转工具（仅此一处需要）。
- 不动公众门户"采购管理端"卡片（保留为独立入口）。
- 不新增 / 修改后端 API、cookie 机制、proxy 逻辑。

## 6. 测试要点（手动验证）

- 专家 Tab：`wangjg / wangjg@2026` → 进入 `:3005/` 专家工作台。
- 管理员 Tab：`caigou / caigou@2026`、`lizhuren / lizhuren@2026` → 跳 `:3004/dashboard` 且已登录。
- 串角色拦截：管理员 Tab 填专家账号 → 报错停留；专家 Tab 填管理员账号 → 报错停留。
- 错误密码 → 报错停留。
- 经公众门户"在线开评标系统"卡片（带 `forceLogin=1`）进入 → Tab 与登录流程正常。
