# 三门户审查修复·实施计划（2026-09-29 · 已两轮实码复核）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准的审查修复清单（`water-erp/docs/三门户独立审查修复清单-2026-09-29.md`）修复 P0×1 + P1×11 + P2×21 + P3×29，按批次推进、逐批可验证可提交。

**Architecture:** 全部为既有代码定点修复，无新模块、无 schema/迁移。后端改 `apps/api/src/{expert,supplier-portal,auth,notification,bid}`，前端改三门户 + `packages/shared`。每批次独立 commit 序列。

**Tech Stack:** NestJS 11 + Prisma、Next.js 16 + React 19、socket.io、jest（API）、tsx --test（supplier 前端既有模式）。

**Spec:** `water-erp/docs/三门户独立审查修复清单-2026-09-29.md`（每任务标注审查编号，实施须对照该条目证据行号）。

**复核声明（2026-09-29 第二轮实码复核）**：全部 P0/P1 修复点与关键 P2 假设已亲证——含测试基建（expert-portal **无**测试脚本需新增）、client `on401` 钩子已存在（packages/client/src/index.ts:47,102）、`ROLE_PORTAL` 已从 @water-erp/config 导出、`tokenFromRequest` 已在 auth.controller:19 导入、`expertRole` 为中文枚举 `'正选'/'候补'`（schema.prisma:580）、SessionWatchdog 挂于两 layout（prop 不可达，改模块标志）、resolveOwnAnnouncement 三调用点（:1470/:1629/:1765）、事务内三 notify 实址（bid.service.ts:1724-1729）、供应商大厅 `onOpeningRecordUpdated` 仅 refresh 不读 amount（删字段安全）、realtime-notifications 实为 4 份（components/notification/，含 web）。

## Global Constraints

- 修复清单编号（EXP-P0-01 等）必须出现在对应 commit message 首行。
- commit 末尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；**不 push**（等用户明确指令）。
- 后端改动跑 `pnpm --filter api test`；门户新增/修改文件跑该门户 `npx tsc --noEmit` + `pnpm --filter <app> lint`；改 `packages/shared`/`config` 后必须 `pnpm --filter <pkg> build`。
- 无 `schema.prisma` 改动 → 无迁移；若实施中发现必须改 schema，**停下报告**。
- 金额桥接只准经 `packages/shared/src/format-bid.ts` / `apps/api/src/bid/opening-amount-unit.util.ts`，禁止裸 ÷/×10000。
- dev 门户进程在跑（HMR 生效）；不重启基础设施。
- 误报区不得「顺手修」：X-P1-04（供应商 proxy 307，实测驳回）、EXP 存疑-3（scoreTrimEnabled 零呈现=设计内）。

## Review Focus（任务测试未覆盖、最可能咬人的五类输入）

1. 价格公式项目（priceFormulaConfig 非空）且含 PRICE 项 → 专家改分重交必须成功（A1 浏览器验证，现库 cmqhero-bid-proj01 即复现环境）。
2. 同浏览器多门户 cookie 共存 → 供应商页通知 socket 不得再以 token_web 身份加入（A2）。
3. admin 从 :3002 登录 → :3007 不再弹回（B1）；**回归面**：admin 从 :3005 登录仍写 token_web。
4. staff 同账号 :3005+:3007 双活 → :3007 登出不踢死 :3005（B2）；**回归面**：:3005 自己登出仍正常吊销。
5. 已下线/下架/DRAFT 公告 → 供应商三读端不可见正文；**回归面**：正常 PUBLISHED 公告不受影响（C3）。

---

## 批次 A —— 演示前关键

### Task A1: [EXP-P0-01] 价格公式项目专家交分死锁修复

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:2026` 附近（getProject 的 BidProject select 块补 `priceFormulaConfig: true`——与 `scoreItems: { orderBy... }` 同级）
- Modify: `apps/expert-portal/src/lib/score-validation.ts`（新增导出 helper）
- Create: `apps/expert-portal/src/lib/__tests__/score-validation.test.ts` + `apps/expert-portal/package.json` 补 `"test": "tsx --test src/lib/__tests__/*.test.ts"`（照 supplier-portal-next 既有模式；expert-portal 现无测试脚本——已复核）
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx:938,955-979,1496,2226,2229`（validateSupplierScores 唯一调用点=:938，已复核；平板不提交评分 tablet page:176 注释实证，无需改平板）

**Interfaces:**
- Produces: `filterScorableItems<T extends {category: string}>(scoreItems: T[], priceFormulaActive: boolean): T[]`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/__tests__/score-validation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterScorableItems } from '../score-validation';

test('EXP-P0-01: 公式激活时剔除 PRICE 项', () => {
  const items = [
    { id: 'a', category: 'TECHNICAL', maxScore: 30 },
    { id: 'b', category: 'PRICE', maxScore: 30 },
  ];
  assert.deepEqual(filterScorableItems(items, true).map(i => i.id), ['a']);
  assert.deepEqual(filterScorableItems(items, false).map(i => i.id), ['a', 'b']);
  assert.equal(filterScorableItems([{ id: 'a', category: 'TECHNICAL', maxScore: 30 }], true).length, 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd water-erp/apps/expert-portal && npx tsx --test src/lib/__tests__/score-validation.test.ts`
Expected: FAIL（filterScorableItems 不存在）

- [ ] **Step 3: 实现 helper + 后端补字段**

score-validation.ts 追加：

```ts
/**
 * EXP-P0-01：价格分公式激活（priceFormulaConfig 非空）的项目，PRICE 项由系统公式
 * 自动计算——不进专家校验、不进提交 payload、不进进度/汇总分母。
 * 后端 PRICE_FORMULA_ACTIVE 拒收闸保留作纵深（expert.service.ts:1377-1385）。
 */
export function filterScorableItems<T extends { category: string }>(
  scoreItems: T[],
  priceFormulaActive: boolean,
): T[] {
  if (!priceFormulaActive) return scoreItems;
  return scoreItems.filter(si => si.category !== 'PRICE');
}
```

expert.service.ts getProject 的 BidProject select 补 `priceFormulaConfig: true,`（:2026 `scoreItems: { orderBy... }` 所在 select 块同级）。

- [ ] **Step 4: 跑测试通过**（同 Step 2，Expected: PASS）
- [ ] **Step 5: 页面接线（5 处）**

page.tsx（project 加载后派生）：
1. `const priceFormulaActive = !!(project as any)?.priceFormulaConfig;` 与 `const scorableItems = filterScorableItems(project.scoreItems, priceFormulaActive);`
2. `:938` `validateSupplierScores(project.scoreItems, ...)` → `validateSupplierScores(scorableItems, ...)`
3. `:955` `const scoresPayload = project.scoreItems.map(...)` → `scorableItems.map(...)`
4. `:1496` 侧栏进度 `total: project.scoreItems.length` → `total: scorableItems.length`（scored 计数基线同改）
5. `:2226-2229` 汇总两个 reduce → 基于 `scorableItems`
只读 PRICE 卡渲染（:2104-2113）不动。

- [ ] **Step 6:** `pnpm --filter expert-portal test`（新 script）+ `pnpm --filter expert-portal exec tsc --noEmit` + lint
- [ ] **Step 7: 浏览器验证**：种子专家登录 :3006 → EVALUATING 公式项目打分步：其余项打满/填理由 → 提交成功（无「低于满分须填写理由」、无 400）；已交专家改一分重交成功；侧栏进度不含 PRICE 分母。
- [ ] **Step 8:** `pnpm --filter api test`；Commit `fix(expert): EXP-P0-01 公式价格项不进专家校验/payload/进度分母——交分死锁解除（getProject 补发 priceFormulaConfig）`

### Task A2: [X-P1-03] 通知网关握手门户判别

**Files:**
- Modify: `apps/api/src/notification/notification.gateway.ts:16-36`（删本地回退链 tokenFromHandshake，改 import bid.gateway 已导出的同名函数——两函数均已 `export`，已复核；修正头注释假声明「跨门户互不可见」）
- Test: `apps/api/src/notification/notification.gateway.spec.ts`（新建；照 `apps/api/src/bid/bid.gateway.spec.ts` 既有模式——文件存在已复核）

- [ ] **Step 1: 失败测试**（mock socket.handshake.headers，直测导入函数+handleConnection，不启 Nest）：

```ts
// 用例骨架（照 bid.gateway.spec 风格）：
// 1) origin=http://localhost:3004 + token_supplier + 残留 token_web → 加入 user:<supplier sub>
// 2) origin=:3004 + 仅 token_web（无 token_supplier）→ 无 token → client.disconnect(true)
// 3) x-portal: bid + token_bid → 取 token_bid（token_web 残留不干扰）
// 4) origin=:3005 → token_web
```

（bid.gateway 的 tokenFromHandshake 四分支已复核：bid→token_bid||token_web||token、supplier→仅 token_supplier、expert→仅 token_expert、web 默认→token_web||token——正是通知网关需要的判别。）

- [ ] **Step 2: 失败确认 → Step 3: 实现**：删 notification.gateway.ts:21-36 本地函数，改 `import { tokenFromHandshake } from '../bid/bid.gateway';`（纯函数无循环依赖）；头注释 :16-17 改「按握手 X-Portal/Origin 端口判别来源门户，只读对应命名空间 cookie（与 bid.gateway 同链；2026-09-29 X-P1-03 修复——历史无判别回退链导致多门户串台）」。
- [ ] **Step 4:** 测试通过 + `pnpm --filter api test`
- [ ] **Step 5:** 浏览器双开 :3005（staff）+:3004（供应商）→ 供应商页通知只弹自己的，控制台无 disconnect 风暴。
- [ ] **Step 6:** Commit `fix(api): X-P1-03 通知网关握手按门户判别 cookie——修复多门户串台（复用 bid.gateway tokenFromHandshake）`

### Task A3: [SUP-P1-03] 解密回显报价补单位

**Files:** Modify `apps/supplier-portal-next/src/components/opening-decrypt-card.tsx:288`

- [ ] **Step 1:** import `formatOpeningAmount`（实施时以 `my-bids/[projectId]/opening-hall/page.tsx` 既有 import 行为准照抄路径——该卡为 dual-v2 专属（已复核：卡内仅 dual-envelope-core 引用，revealedFields 仅 dual 轨产生））。
- [ ] **Step 2:** `:288` → `<span>报价：<b>{formatOpeningAmount(revealedFields.price, '万元')}</b></span>`
- [ ] **Step 3:** tsc + 浏览器：解密成功卡显示「153.95 万元」。
- [ ] **Step 4:** Commit `fix(supplier): SUP-P1-03 解密成功卡报价走 formatOpeningAmount——万元显式单位`

### Task A4: 一行组（BID-P1-01 + X-P2-02 + BID-P3-02）

**Files（全部实证）：**
- `apps/api/src/bid/bid.controller.ts:538-541`：decrypt-all 补 `@Roles('admin', 'bid_host')`
- `packages/shared/src/bid-events.ts:207-213`：`OpeningRecordUpdatedPayload` 删 `amount: number;` 及注释（消费方供应商大厅 :333-335 仅 refresh 不读 amount，已复核，删除安全）
- `apps/api/src/bid/bid-opening-record.service.ts:227-235`：emit 对象删 `amount: Number(dto.amount),`，注释补「金额不带——读端刷新拉全量（X-P2-02）」
- `apps/bid-portal/src/components/workspace/project-tabs.tsx:31` 与 `apps/bid-portal/src/app/(dashboard)/bid/page.tsx:174`：「采购管理工作台启动评标」→「在本工作区『评标管理』tab 完成启动评标…」（两处实证）
- `apps/bid-portal/src/components/opening-hall.tsx:149-150`：注释清单补 decrypt-all（实证在 :149-150）

- [ ] **Step 1:** 五处编辑；改 shared 后 `pnpm --filter @water-erp/shared build`。
- [ ] **Step 2:** `pnpm --filter api test` + `pnpm --filter bid-portal exec tsc --noEmit`；`grep -c "amount" packages/shared/src/bid-events.ts` 确认 OpeningRecord 段无残留。
- [ ] **Step 3:** leader 账号携 token_bid curl decrypt-all → 403。
- [ ] **Step 4:** Commit `fix(bid): BID-P1-01 decrypt-all 收口 admin/bid_host + X-P2-02 WS 唱标载荷不带金额 + BID-P3-02 启动评标文案对齐分工v3`

---

## 批次 B —— 鉴权链

### Task B1: [X-P1-01] admin 非web门户登录写 token_bid（+清 bid.gateway token_web 回退）

**Files:**
- Modify `apps/api/src/auth/auth.controller.ts:144-150`（requestPortal 变量在 :144 已存在，已复核）
- Modify `apps/api/src/bid/bid.gateway.ts:91-94`（删 `|| map.get('token_web') || map.get('token')`，注释注明随 X-P1-01 收口；存量 admin 旧会话需重登，dev 可接受）
- Test: 扩展 `apps/api/test/auth.e2e-spec.ts`（「单设备登录」describe 在 :206，模式可参照——已复核）

- [ ] **Step 1: e2e 失败测试**（新增 describe「admin 公共门户登录分流」）：

```ts
// ① X-Portal: public + Swhi-CGZX-admin 登录 → Set-Cookie 为 token_bid；该 cookie 调 /auth/me（X-Portal: bid）→ 200 role=admin
// ② 回归：X-Portal: web 同账号 → Set-Cookie 仍 token_web（:3005 可用性）
```

- [ ] **Step 2: 失败确认 → Step 3: 实现**：auth.controller.ts :150 分流块后追加：

```ts
// X-P1-01（2026-09-29）：admin 从公共门户（或任意非 web 门户）登录后按 ROLE_PORTAL 落地 :3007，
// cookie 须写 bid 命名空间——bid-portal 只读 token_bid，写 token_web 落地即 401 弹回。
// admin 明确从 :3005（requestPortal==='web'）登录保持 token_web（账号管理在 :3005）。
if (result.role === 'admin' && requestPortal !== 'web' && ROLE_PORTAL[result.role] === 'bid') {
  cookiePortal = 'bid';
}
```

import 补 `ROLE_PORTAL`（`@water-erp/config` 已导出且 dist 在——已复核；auth.controller 现有 import 块追加即可）。

- [ ] **Step 4:** e2e 通过 + `pnpm --filter api test`
- [ ] **Step 5:** 浏览器：:3002 用 Swhi-CGZX-admin 登录 → 落地 :3007 不弹回；:3005 同账号正常进账号管理。
- [ ] **Step 6:** Commit `fix(auth): X-P1-01 admin 非web门户登录写 token_bid——修通用登录落地 :3007 死环；bid.gateway 撤 token_web 回退`

### Task B2: [X-P1-02] logout 仅吊销带 sid 会话

**Files:** Modify `apps/api/src/auth/auth.controller.ts:274-280`、`apps/api/src/auth/auth.service.ts`（加方法）；Create `apps/api/src/auth/auth.service.session.spec.ts`（auth.service.spec 不存在，已复核，新建）

- [ ] **Step 1: 失败单测**：`shouldRevokeSession`——带 sid 合法 token→true；无 sid token（bid 形态）→false；坏 token→false。
- [ ] **Step 2: 失败确认 → Step 3: 实现**

auth.service.ts（`private jwt: JwtService` 已注入 :35，已复核）：

```ts
/** X-P1-02：登出吊销仅适用于带 sid 的单设备会话（web/supplier/expert 命名空间）；
 * token_bid 等无 sid 会话登出不得清 webSessionId——否则跨命名空间误杀同账号 :3005 活会话。 */
async shouldRevokeSession(token: string): Promise<boolean> {
  const payload = await this.jwt.verifyAsync<{ sid?: string }>(token).catch(() => null);
  return !!payload?.sid;
}
```

auth.controller logout :274-280 改（`tokenFromRequest` 已在 :19 导入并在 :231 有用例，直接用）：

```ts
const token = tokenFromRequest(req);
// 登出即吊销（2026-09-18；X-P1-02 2026-09-29 修正）：仅当登出者所用 token 带 sid
// （web/supplier/expert 单设备命名空间）才清会话 ID；token_bid（无 sid）登出不清——
// 防止 :3007 登出杀死同账号在 :3005 的活会话。无 sid 会话本就不校验此列。
if (token && (await this.authService.shouldRevokeSession(token))) {
  await this.prisma.user.update({ where: { id: userId }, data: { webSessionId: null } });
}
```

- [ ] **Step 4:** 单测过 + `pnpm --filter api test`
- [ ] **Step 5:** 手工：:3005 登录 Swhi-CGZX-05 → :3006 管理员 tab 进 :3007 → :3007 退出 → :3005 仍可操作；:3005 自己退出 → :3005 下个请求 401（回归面）。
- [ ] **Step 6:** Commit `fix(auth): X-P1-02 logout 仅吊销带 sid 会话——修跨命名空间互杀`

### Task B3: [X-P2-01] bid-portal 补 401 语义

**Files:**
- Modify `apps/bid-portal/src/lib/api.ts:12`（`createApiClient({ portal: 'bid' })` 加 `on401` 回调——钩子已存在于 packages/client index.ts:47,102-104，已复核）
- Create `apps/bid-portal/src/components/session-watchdog.tsx`（从 expert-portal 同名组件移植：15s `GET /auth/heartbeat`；遮罩简化为「账号已冻结/登录已失效」+ 重登按钮，跳转用 :3007 proxy.ts 同款 Host 头构建 `http://<host>:3006/login?forceLogin=1`——**勿用** portalURL 绝对常量）
- Modify `apps/bid-portal/src/components/app-shell.tsx`（挂 watchdog；:51/:70 两处裸 fetch 补 `headers: { 'X-Portal': 'bid' }`）

- [ ] **Step 1:** 移植+接线；**Step 2:** tsc + lint；**Step 3:** 手工：:3007 登录 bid_host → :3005 冻结该账号 → :3007 15s 内出遮罩；解冻重登恢复。
- [ ] **Step 4:** Commit `fix(bid): X-P2-01 bid-portal 补 on401 冻结/失效遮罩 + 15s 心跳 watchdog + 裸 fetch 补 X-Portal`

---

## 批次 C —— 供应商门户

### Task C1: [SUP-P1-04 + SUP-P3-10] 草稿恢复死键 + 证书预热死条件

**Files:** Modify `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx`

- [ ] **Step 1:** 组件内加两个 ref（`dekKeyRef` 同款模式）：

```ts
const draftKeyRef = useRef(draftKey); draftKeyRef.current = draftKey;
const draftApiRef = useRef(draft); draftApiRef.current = draft; // 取最新 hook 实例（restoreDraft 闭包随 key 更新）
```

- [ ] **Step 2:** mount effect `:485-486`：`readDraftTs(draftKey)` → `readDraftTs(draftKeyRef.current)`；`draft.restoreDraft()` → `draftApiRef.current.restoreDraft()`。
- [ ] **Step 3:** `:484` `if (profile?.sm2PublicKey)` → `if (prof?.sm2PublicKey)`（effect 内 Promise.all 已解构的局部变量——死条件根源同 P1-04 闭包）。
- [ ] **Step 4:** tsc；浏览器：填表单→刷新→「检测到本地草稿」横幅出现→恢复成功；已递交记录回显不受影响。
- [ ] **Step 5:** Commit `fix(supplier): SUP-P1-04 草稿恢复经 ref 读最新键 + SUP-P3-10 证书预热改用已加载 profile`

### Task C2: [SUP-P1-01] 拆分标书每类限 1 文件 + 明示

**Files:** Modify `submit/page.tsx`（AddFileButton 定义 :82、使用 :937——已复核）、提交前检查弹窗（grep「已上传」定位）

- [ ] **Step 1:** 拆分类文件达 1 个后：AddFileButton `disabled`，列表下常驻灰字「本类别仅第一个文件参与评审与密封，请合并后上传」。
- [ ] **Step 2:** 提交前检查弹窗按类分组，每类标注「参检文件：第 1 个」。
- [ ] **Step 3:** tsc + 浏览器：技术类传第 2 个文件被阻/明示；提交成功且 envelope 仅含首个。
- [ ] **Step 4:** Commit `fix(supplier): SUP-P1-01 拆分标书每类限 1 文件并明示参检口径——消除静默丢弃`

### Task C3: [SUP-P1-05] resolveOwnAnnouncement 状态闸

**Files:** Modify `apps/api/src/supplier-portal/supplier-portal.service.ts:1179-1201`（三调用点 :1470/:1629/:1765 已复核；metadata fallback 二次查询同加过滤）；`apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx`（:589 dangerouslySetInnerHTML 处兜底文案）

- [ ] **Step 1: 失败测试**（新建 supplier-portal service spec 或就近）：DRAFT/OFFLINE/HIDDEN → null；PUBLISHED 且 publicityEnd 已过 → 标题壳（content 空 + titleOnly）；PUBLISHED 未到期 → 原样。
- [ ] **Step 2: 实现**——函数内先轻量探测（与 caller select 解耦）：

```ts
// SUP-P1-05（2026-09-29）：对齐 09-26 v2 下线政策——OFFLINE/HIDDEN/DRAFT 完全不出；
// 公示期满 PUBLISHED / 存量 ARCHIVED 仅标题壳（镜像 announcement.service isOfflined/titleOnlyStub 口径）。
const visibilityWhere = { relatedProjectCode: { in: codes }, type: 'BID_NOTICE' as const, status: 'PUBLISHED' as const };
const probe = await this.prisma.announcement.findFirst({
  where: visibilityWhere, orderBy: { createdAt: 'desc' }, select: { id: true, publicityEnd: true },
});
if (!probe) return null;
if (probe.publicityEnd && new Date(probe.publicityEnd).getTime() < Date.now()) {
  // 标题壳：仅元信息（caller select 中非正文字段），content 置空、titleOnly 标记
  const stub = await this.prisma.announcement.findFirst({ where: { id: probe.id }, select: { ...select, content: true } as any });
  return stub ? { ...stub, content: '', titleOnly: true } as any : null;
}
// …原有正文查询（where 补 status: 'PUBLISHED'）；metadata fallback 查询同加
```

- [ ] **Step 3:** 消费端：`bids/[id]/page.tsx:589` 处 `project.announcement?.titleOnly || !project.announcement` → 渲染「该公告已下线或不可见，正文不可查看」占位；`:1765` document 分支拿到 null 时 getBidProjectDocument 返回明确错误文案（如 `ANNOUNCEMENT_OFFLINED`，实施时看该端点现有错误模式对齐）。
- [ ] **Step 4:** `pnpm --filter api test` + 浏览器（种子有现成下线公告则直用；改库前征得用户同意）。
- [ ] **Step 5:** Commit `fix(api): SUP-P1-05 项目侧公告读端补状态闸——下线/下架/草稿正文不再外泄（对齐 09-26 v2 政策）`

### Task C4: [SUP-P1-02 + SUP-P2-02] DANGER 态重封补传 + decryptUpload res.ok

**Files:**
- Modify `apps/supplier-portal-next/src/lib/api/opening-package.ts`（:36-43 一并修 SUP-P2-01 URL 前缀三元）
- Modify `apps/supplier-portal-next/src/components/opening-decrypt-card.tsx:297-304`（DANGER 分支）

- [ ] **Step 1: opening-package.ts**：`decryptUpload` 补 `if (!res.ok) throw new ApiError(...)`（取响应体 error 文案）；URL 三元删除直接用 UPLOAD_BASE（=SUP-P2-01，同文件顺带）；新增：

```ts
/** SUP-P1-02：解密异常恢复——重新密封补传（multipart：file/role/envelope/signature/ciphertextSha256） */
export async function reuploadDual(projectId: string, form: FormData): Promise<unknown> {
  const res = await fetch(`${UPLOAD_BASE}/supplier-portal/bid-submissions/${projectId}/reupload-dual`,
    { method: 'POST', body: form, credentials: 'include' });
  if (!res.ok) throw await toApiErrorLike(res); // 与 decryptUpload 同款归一
  return res.json();
}
```

- [ ] **Step 2: 解密卡 DANGER 分支**加折叠面板「重新密封补传（解密持续失败时）」：选角色 → 选文件 → `reencryptDualFile(file, role, ukey, certSn, certPublicKey, admin, prevEnvelope, onProgress)`（签名已复核 dual-envelope-core.ts:168；`prevEnvelope` 取自「我的投递」载荷——getBidSubmission/getMySubmissions 全字段返回含 envelope（sup-review 存疑-6 实证）；ukey/证书路径复用本页解密按钮同一获取链；admin 证书经提交页同款 `getAdminCertCached`）→ POST → 成功提示「已补传，等待主持人重新触发解密」。
- [ ] **Step 3:** 组件 `:226-229` reason 兜底仅在 HTTP 200+DANGER 时到达（上游已抛错）——确认分支自然成立。
- [ ] **Step 4:** tsc + lint；浏览器：种子「四川省通信产业服务有限公司」触发 DANGER 后可见入口，mock U盾全链走一次补传。
- [ ] **Step 5:** Commit `fix(supplier): SUP-P1-02 解密 DANGER 态补重封补传入口 + SUP-P2-01 URL 前缀 + SUP-P2-02 decryptUpload 检查 res.ok`

### Task C5: 供应商 P2 余项（SUP-P2-03/04/05/06/07）

- [ ] **SUP-P2-03** `supplier-portal.service.ts:1903-1908` DUAL_DISABLED 文案改「平台双层信封服务维护中，请联系管理员处理投标事宜」；submit 页捕获该 code 显示同义横幅；CLAUDE.md 双信封清单节补「回退仅指 API 侧放行，门户旧轨表单已下线，供应商投递需管理员线下引导」。
- [ ] **SUP-P2-04** `supplier-portal.controller.ts:834` 建 `SubmitQuoteDto`（`bidSupplierId: string` + `quotePrice: @IsPositive() @Max(1e12)`），service 两位小数规整；`round-quote/page.tsx:86-87` 前端 >0 校验。
- [ ] **SUP-P2-05** `round-quote/page.tsx:199-205`：条件收窄 `e instanceof ApiError && e.code === 'ALREADY_QUOTED'`。
- [ ] **SUP-P2-06** `dashboard/page.tsx:278`（实证 `resp?.id || resp?.url || ""`）：→ `resp?.url || ""`。
- [ ] **SUP-P2-07** `register/page.tsx:175-178`：匿名时固定键 `getRegistrationDraftKey('anonymous')` 启用本机草稿，提交成功/离开流程清除；页头注释更正。（若发现隐私顾虑设计意图，改为删横幅+注释并在 commit 说明——二选一，倾向前者。）
- [ ] 验证：`pnpm --filter api test` + tsc + 浏览器抽测报价轮 0 值被拒、转正资质可打开。
- [ ] Commit `fix(supplier): SUP-P2-03/04/05/06/07 五项打包——DUAL_DISABLED文案/报价DTO/重复提交误报/转正fileUrl/匿名草稿`

---

## 批次 D —— 专家门户

### Task D1: [EXP-P1-01] 标注/备注保存失败就地报错

**Files:** Modify `apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx:205-209,231-233`

- [ ] **Step 1:** 顶部 `import { toast } from 'sonner';`（evaluate page.tsx:6 同源；本面板现无 toast import——已复核）。
- [ ] **Step 2:** setVerdict catch 补 `toast.error(e?.message || '标注保存失败，已回滚')`（回滚保留）；saveNote catch 补 `toast.error(e?.message || '备注保存失败，请重试')` + `touchedRef.current.add(item.id)`；删两处 `/* toast 由全局拦截器处理 */` 假注释。
- [ ] **Step 3:** tsc；浏览器：devtools offline 下点「异议」→ 回滚+toast；恢复网络重试成功。
- [ ] **Step 4:** Commit `fix(expert): EXP-P1-01 条款标注/备注保存失败就地 toast——消除静默丢数据`

### Task D2: [EXP-P1-02] 桌面 AppShell 非 401 走重试

**Files:** Modify `apps/expert-portal/src/components/app-shell.tsx:56-70`

- [ ] **Step 1:** checkAuth 照 `(tablet)/layout.tsx:32-54` 逐行移植：`if (!r.ok) throw new Error('HTTP ' + r.status)` → catch `setAuthError(true)` + `retryRef`（MAX_RETRIES=3，3000×n 退避）+ fetch 补 `headers: { 'X-Portal': 'expert' }`（覆盖 EXP-P3-05 app-shell 部分）。
- [ ] **Step 2:** tsc；浏览器：暂停 API 5s 再恢复 → 桌面出错误横幅可重试，不被弹登录。
- [ ] **Step 3:** Commit `fix(expert): EXP-P1-02 桌面 AppShell 非 401 走重试——对齐平板，评标中不再误登出`

### Task D3: [EXP-P2-07] 迁移 claimed 态心跳抑制（模块级标志）

**复核修正**：SessionWatchdog 挂于 `(app)/layout.tsx:11` 与 `(tablet)/layout.tsx:151`（布局层），迁移弹窗在 evaluate 页——**prop 不可达**，改用模块级标志。

**Files:**
- Create `apps/expert-portal/src/lib/transfer-claimed-flag.ts`
- Modify `apps/expert-portal/src/components/session-watchdog.tsx`、`apps/expert-portal/src/lib/session-kick.ts`
- Modify `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx:2390-2396`（迁移弹窗 claimed 态）

```ts
// lib/transfer-claimed-flag.ts
/** EXP-P2-07：本端签发的工位迁移已被平板领取——桌面心跳停跳，SESSION_REPLACED 呈中性「会话已移交」。 */
let claimed = false;
export const markTransferClaimed = () => { claimed = true; };
export const isTransferClaimed = () => claimed;
```

- [ ] **Step 1:** 迁移弹窗进入 claimed 态调 `markTransferClaimed()`。
- [ ] **Step 2:** session-watchdog 心跳前 `if (isTransferClaimed()) return;`（并停 interval）；session-kick 遮罩对 `isTransferClaimed()` 场景：文案改「会话已移交至打分平板，本页可安全关闭」，去掉 20s 强跳与「反馈管理员」按钮。
- [ ] **Step 3:** 浏览器：桌面签发迁移码→平板领取→桌面弹「已迁移」不再出「异地登录」遮罩。
- [ ] **Step 4:** Commit `fix(expert): EXP-P2-07 迁移 claimed 态停跳桌面心跳——自家迁移不再呈现为疑似冒用`

### Task D4: 专家 P2 余项（EXP-P2-02/03/04/05/06）

- [ ] **EXP-P2-04** `profile/page.tsx:86`：脱敏 `` `${(id ?? '').slice(0, 4)}********${id.slice(-3)}` ``（<7 位整串打码），title「完整号码请联系管理员核验」。
- [ ] **EXP-P2-05** `page.tsx:254-257` 四 case 与 tablet `:411-414` 补 `&& !!expert?.confidentialityAgreed && !!expert?.disciplineAgreed`；**实施时先 grep** getProject 的 myExpertRecord select 是否含两列（:312 experts 列表 select 未含——已复核），未含则补 select。
- [ ] **EXP-P2-06** `expert.service.ts:1910-1924` listClarifications 加 `supplierId: { notIn: expert.conflictedSupplierIds ?? [] }`；`:1928-1957` createClarification 入口拒回避供应商（403 `CONFLICTED_SUPPLIER`）；前端 `:1396` 下拉同滤。单测进 expert.service.spec（2841 行既有基建）。
- [ ] **EXP-P2-03** `(app)/page.tsx:406` isLeadAnywhere → per-project canClose（照 `tasks/page.tsx:332-341` 口径，数据源 tasks 返回体已含 isLead/myExpertId/createdBy）。
- [ ] **EXP-P2-02（复核修正）**：`expertRole` 为中文枚举 `'正选'/'候补'`（schema.prisma:580）——向导第 1 步按 `myExpertRecord?.expertRole !== '正选'`（已含 :289 下发）分流「候补待命」横幅+隐藏签到入口；WS：role_changed 里程碑现只发 host 房（bid.gateway :397-399 已复核），后端 `notifyExpertPresence` 补「`data.milestone === 'role_changed'` 时向 `experts:${projectId}` 房 emit 轻量刷新事件」；前端 `use-expert-websocket.ts` 订阅该事件 → `loadProject()`。
- [ ] 验证：`pnpm --filter api test` + tsc + 浏览器抽测回避澄清被拦、候补账号见待命横幅。
- [ ] Commit `fix(expert): EXP-P2-02/03/04/05/06 五项打包——候补呈现+转正推送/结束投票口径/身份证脱敏/五项核验闸/澄清回避屏蔽`

---

## 批次 E —— 横切与清欠

### Task E1: 横切 P2（X-P2-03/04/05/07/08/09）

- [ ] **X-P2-03** 供应商 5 处 stageMap（`bids/[id]:58-64`、`my-bids:22-28`、`bids:43-48`、`dashboard:76-81`、`bid-stage-timeline.tsx:4-9`）：label/color 改引 shared `STAGE_LABEL/STAGE_COLOR`（constants.ts:35-45 含 ABORTED「流标」——已复核），本地留 guide；`:497-499` 空徽标自然消除。
- [ ] **X-P2-04** `submit/page.tsx:167-173` 删本地 formatBidPrice，preflight 改 shared `formatBidPrice`（unitHint 按轨道）；`my-bids:62-67` 同轮换。
- [ ] **X-P2-05** `expert-portal/lib/api.ts:39-54` fetchApi 改用共享判空（`const text = await res.text(); return text ? JSON.parse(text) : undefined`——共享实现形态见 packages/client index.ts:114-117，已复核）；本地 `ApiError` 改 `export { ApiError } from '@water-erp/client'` re-export。
- [ ] **X-P2-07** `apps/web/src/app/(main)/supplier/approval/page.tsx:145-147`：门改 `['admin','leader','staff'].includes(currentUser?.role)`，注释更正 09-26 口径。
- [ ] **X-P2-08** `supplier-portal.service.ts:716-719`：certSn 双侧 `toLowerCase()`；DN 经 `normalizeDn`（trim+多空格归一）后比对，注释引 publicKey 归一先例。
- [ ] **X-P2-09** `supplier-portal-next/src/hooks/use-bid-websocket.ts`：透传 `onReconnected`（照 bid-portal 版 :59/:126）；`opening-hall/page.tsx` 传 `() => refresh()` + 顶部连接徽标/「刷新」按钮（=SUP-P3-06 一并完成）。
- [ ] 验证：三门户 tsc+lint；浏览器供应商大厅断网重连自动补拉。
- [ ] Commit `fix(portals): X-P2-03/04/05/07/08/09 六项打包——STAGE收敛/金额桥接/ApiError统一/审批角色/证书归一/供应商WS补拉`

### Task E2: BID-P3 组（BID-P3-01/03/04）

- [ ] **BID-P3-01** `opening-hall.tsx:751-761`（组建会话按钮补 `canHost &&`）、`:819-838`（延长+15分钟补 `canHost &&`）。
- [ ] **BID-P3-03** `bid.service.ts:1724-1729` 三 notify 移出 `$transaction` 回调至事务 await 后（照 completeOpening :1107-1112 模式；**注意**：`sessionUpserted`/`action`/`result` 等回调内变量须提级到事务外声明——事务结构 :1684-1730 已复核）。
- [ ] **BID-P3-04** `bid/page.tsx:44-67` 与 `archive/page.tsx`：自增 requestId 丢弃过期响应（照 evaluation-view.tsx:471-474 cancelled 模式——已复核）。
- [ ] 验证：`pnpm --filter api test` + tsc + lint。
- [ ] Commit `fix(bid): BID-P3-01/03/04 三项打包——canHost收口/WS事务后置/轮询并发防护`

### Task E3: P3 清欠组

逐项小改（对照清单证据行；关键定位已复核项注明）：
- EXP-P3-01（evaluate:999/1013、invitation:55 三处 window.confirm→ConfirmDialog）、EXP-P3-02（删 expert.service.ts:208-214 recentActivity 查询）、EXP-P3-03（report-step.tsx:230-241 firstPassed→`items.every(i => i.passed !== false)` 聚合）、EXP-P3-04（删 page.tsx:1483-1485 死代码）、EXP-P3-05 余项（api.ts:35 跳转带 `?redirect=`；dashboard:44 补 X-Portal）、EXP-P3-06（tablet:582-588 轮询条件补 `|| roomGatePending`；两端 onReconnected 接线 loadProject——与 D4 网关事件协同）、EXP-P3-07（ReportStep 传 evaluationOverdue 禁用）、EXP-P3-08（tablet normalizeDraftScores :276-286 补 passed 重导——照桌面 :488-494 移植）。
- SUP-P3-01（切 submissionMode 清另一模式文件字段 :899-900）、SUP-P3-02（opening-hall:322-323 比对改本司 bidSupplier id——取得路径实施确认）、SUP-P3-03（删 A-87 死代码端点+前端函数）、SUP-P3-05（seal fail→解密按钮 disabled :312）、SUP-P3-07（my-bids dual-v2 行 stage 过 OPENING 显 decryptedPrice+unitHint）、SUP-P3-08（loadBidDoc catch 区分「无文件/不可获取(原因)」）、SUP-P3-09（change-password 下限对齐注册 ≥8 位）、SUP-P3-11（canWithdraw 补 `nowMs < deadline`）。
- X-P3-02（BidStage 收敛 shared）、X-P3-03（**路径修正**：`components/notification/realtime-notifications.tsx` 实为 4 份含 web——wsUrl 提取到 @water-erp/config）、X-P3-04（供应商通知 toast 走归一化）、X-P3-05（portal-cookie.ts:11-17 注释更正）、X-P3-06（supplier api.ts:105-112 put/patch/delete 补 timeout）、X-P3-07（评标办法映射上收 shared 或两表对齐，倾向上收）。
- 验证：全门户 tsc+lint+`pnpm --filter api test`。
- Commit（按门户拆 2-3 个）：`chore(portals): 三门户 P3 清欠（编号见 body）`。

---

## 决策请求（存疑 10 项——需用户裁定后才排修复）

| # | 存疑项 | 我的建议 |
|---|--------|---------|
| 1 | [EXP] signIn 不设口令闸 | 维持现状，2026-09-20 spec 补口径一句 |
| 2 | [EXP] assist 降级分支未逐行 | 下轮深审，本轮不动 |
| 3 | [EXP] scoreTrimEnabled 专家零呈现 | 维持（与可见性收口自洽） |
| 4 | [SUP] scope=INVITED 计数边界 | 补 e2e 断言即可，不改逻辑 |
| 5 | [SUP] 60s 接管无中间态 | 补「解密中（超 60s 平台介入）」提示，低优先 |
| 6 | [SUP] getMySubmissions 载荷宽度 | 维持 |
| 7 | [BID] loadResults 静默置空 | 补 liveFailed 同款告警（并入 E2 顺手） |
| 8 | [BID] extend-evaluation 自查自批 | 文案改「可由具备权限的领导/管理员或现场主持人在本页审批」，角色集维持 |
| 9 | [X] f.url 溯源 | 下轮深审 |
| 10 | [X] bid.gateway token_web 回退 | **已在 B1 清理** |

## 明确不修

- X-P1-04（供应商 proxy 307）：实测驳回（307 Location 相对路径）。
- EXP 存疑-3、SUP 存疑-6：设计内。
- 20+ 无恙域（金额链/状态机/签字三态/时限闸等）：不动，防误修。

## 总验证（全部批次完成后）

1. `pnpm --filter api test` 全量
2. 四门户 `npx tsc --noEmit` + `pnpm --filter <app> lint`（supplier/expert/bid/web）
3. e2e（可选）：`pnpm --filter api test:e2e`（B1/B2/C3 有新用例）
4. 浏览器端到端五幕：①公式项目专家改分重交成功 ②:3002 admin 直达 :3007 ③:3007 登出不踢 :3005 ④多门户通知不串台 ⑤解密 DANGER 重封补传全链
5. `git status` 干净、commit 编号齐全、**不 push**
