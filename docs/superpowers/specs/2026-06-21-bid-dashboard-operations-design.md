# 开评标总览「操作」列增强设计

- **日期**：2026-06-21
- **状态**：已确认（设计批准 + 渠道选 B）
- **涉及**：`apps/bid-portal`（前端）、`apps/api`（后端，仅新增薄一层催办端点）

## 1. 背景与问题

`apps/bid-portal` 的开评标总览页 `bid/page.tsx` 第 429–493 行的「操作」列目前仅有 3 个动作：阶段主操作（启动开标/进入评标/查看归档/准备中）、编辑、检查工作区。大量真实管理操作（催办、发标、跳转专家抽取、生成评标结果、导出归档、澄清等）缺席，管理员几乎每件事都要点进项目详情才能完成。

总览页应是一个**操作启动台**，把整个投标/开标生命周期里高频的管理动作直接暴露在行内。

## 2. 目标

1. **阶段门控**——只展示当前阶段真正合法的动作，避免误操作（遵循 `bid-state.ts` 的 `DOWNLOAD→SUBMIT→OPENING→EVALUATING→ARCHIVED` 流转约束）。
2. **主次分明**——行内主操作高亮，次要操作收进下拉菜单，保持表格整洁。
3. **最大化复用**——优先接线已有后端端点；仅「催办」新增薄一层端点。
4. **专家抽取不迁移**——用跨门户链接跳到 web 门户（:3005）抽取页，并透传 `projectId` 预填（页面已支持 `q.get('projectId')`，见 `apps/web/.../expert/extract/page.tsx:21`）。

## 3. 操作矩阵（阶段门控）

主操作为行内高亮按钮；「更多 ▾」为下拉项；快捷图标始终在行尾。

| 阶段 | 主操作 | 更多 ▾ 下拉项 |
|---|---|---|
| **DOWNLOAD** 发标期 | `开放投递`（→SUBMIT） | 查看公告 · 催促供应商投标 · ⚠ 尚未抽取专家→去抽取`*` · 编辑 |
| **SUBMIT** 投标期 | `进入准备` | 查看投标进度 · 催促未投标供应商 · ⚠ 尚未抽取专家→去抽取`*` · 查看公告 |
| **OPENING** 开标中 | `进入开标大厅` | 启动评标（就绪时）· 催促未签到专家 · 处理异议 · 监督视图 |
| **EVALUATING** 评标中 | `进入评标管理` | 生成评标结果 · 催促未完成评分专家 · 发起澄清 · 查看评分 |
| **ARCHIVED** 已归档 | `查看归档` | 导出归档包(JSON/CSV) · 发布结果公告 · 查看监督日志 |

`*` 跳转专家抽取项：仅当 `expertCount === 0` 时显示为醒目提示项（橙色 + AlertTriangle）；已抽取则隐藏。

**始终显示的快捷图标**：✏️ 编辑 · 🔍 检查工作区（保留现有 inline 展开行为）。

**催办类动作的智能门控**（避免催空）：
- 催促供应商：仅当 `supplierSubmitted < supplierCount` 时启用，否则置灰 + tooltip「全部已提交」。
- 催促专家签到：仅当 `expertSignedIn < expertCount` 时启用。
- 催促评分：仅当评标阶段且有专家未提交评分时启用（需 workspace/评分数据支撑；首版可用「有专家未完成」粗判，后续细化）。

## 4. UI 模式

```
[ 主操作 ]  [ 更多 ▾ ]  ✏️  🔍
```

- 主操作沿用现有配色（绿/紫/灰，按阶段）。
- 「更多 ▾」使用 Lucide `ChevronDown`，点击弹出右对齐菜单：1.5px 描边、`rounded-xl`，遵循 `.impeccable.md` 工业风（无渐变按钮、无 emoji 当图标）。
- 菜单项：图标 + 文案；不可用态置灰 + tooltip 说明原因；危险/强提示项（如尚未抽取专家）加 `AlertTriangle` + 橙色。
- 新建可复用下拉组件 `ActionMenu`（`apps/bid-portal/src/components/action-menu.tsx`），click-outside 关闭，Esc 关闭。

## 5. 后端改动

### 5.1 已有能力（直接接线，零后端改动）

| 前端动作 | 现有端点 |
|---|---|
| 开放投递 | `POST /bid/projects/:id/open-submission` |
| 启动开标 | `POST /bid/projects/:id/open` |
| 启动评标 | `POST /bid/projects/:id/start-evaluation` |
| 一键归档 | `POST /bid/projects/:id/archive-all` |
| 生成评标结果 | `POST /bid/projects/:id/evaluation-results/generate` |
| 发起澄清 | `POST /bid/projects/:id/clarifications` |
| 导出归档包 | `GET /bid/projects/:id/archive-package/export?format=` |

### 5.2 新增：催办端点（仅这一处后端新增）

```
POST /api/bid/projects/:id/nudge-suppliers
  body: { onlyUnsubmitted?: boolean }   // 默认 true：只催未提交者
  → 对命中的每个供应商用户调用 NotificationService.create()
  → 返回 { reached: number }

POST /api/bid/projects/:id/nudge-experts
  body: { reason: 'signin' | 'score' }   // 签到催促 / 评分催促
  → 对命中的每个专家用户调用 NotificationService.create()
  → 返回 { reached: number }
```

**关键事实**：`NotificationService.create()`（`notification.service.ts:44-58`）已内置多通道——写站内信 → 记 `in_app` 投递日志 → 异步分发 Email/SMS。因此催办端点只需：
1. 查出项目相关 user（供应商用户 / 专家用户）。
2. 逐个 `notificationService.create({ userId, type: 'bid_nudge', title, content, link })`。
3. 记一条 `AuditLog`（谁、哪个项目、催了谁、几人）。
4. 返回 `{ reached: N }`。

**SMS 渠道现状（需如实告知用户）**：`notification.service.ts:26-27` 表明 `User` 模型当前无 `phone` 字段，`shouldDispatch('sms', …)` 恒为 false，短信实际 skip。**Email 立即可用**，SMS 待后续给 `User` 加 `phone` 字段后自动激活——本次不扩 schema。

### 5.3 跨门户跳转（前端）

```ts
import { portalURL } from '@water-erp/config';
window.open(portalURL('web', `/expert/extract?projectId=${p.id}`), '_blank');
```

bid 门户与 web 门户共享 `token_web` cookie，跨门户带 session（见 CLAUDE.md「Auth & Cookie Isolation」）。

## 6. 实施步骤（建议顺序）

1. **后端**：`apps/api/src/bid/`
   - 在 `bid.module.ts` 引入 `NotificationModule`（已 export `NotificationService`）。
   - `bid.service.ts` 增 `nudgeSuppliers(id, onlyUnsubmitted, actorId)` 与 `nudgeExperts(id, reason, actorId)`：查参与者 → 逐个 `create()` 通知 → 写 `AuditLog` → 返回计数。
   - `bid.controller.ts` 增 2 个 `@Post` 端点（不加方法级 `@Roles`，继承类级 `admin/bid_host/procurement_staff` 三角色，与其余端点一致）。
   - 补单元测试（`bid.service.spec.ts`）：mock NotificationService，断言调用次数与门控。
2. **前端组件**：新建 `apps/bid-portal/src/components/action-menu.tsx`（下拉菜单，click-outside/Esc 关闭）。
3. **前端接线**：改造 `bid/page.tsx` 操作列——主操作按钮 + `<ActionMenu>` + 快捷图标；按阶段 + readiness 计算菜单项与可用态。
4. **前端 API 封装**：`apps/bid-portal/src/lib/api/bid.ts` 增 `nudgeSuppliers(id)` / `nudgeExperts(id, reason)`。
5. **验证**：`pnpm --filter api test -- bid`；`pnpm lint`；手动在 :3007 覆盖各阶段菜单项与催办 toast。

## 7. 不做（YAGNI）

- 不迁移专家抽取到 bid 门户（仅跨门户跳转）。
- 不给 `User` 加 `phone` 字段（SMS 暂时 skip，留待后续）。
- 不做催办频率限流之外的复杂防骚扰策略（仅 `@Throttle` 基础限频即可）。
- 不新增「公告/结果公告」的发布后端——「查看公告」跳信息门户、「发布结果公告」跳 web 门户公告中心，复用既有页面。
