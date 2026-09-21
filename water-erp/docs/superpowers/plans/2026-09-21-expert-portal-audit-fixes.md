# 专家门户审查缺陷修复实施计划（P2×3 + P3×4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（本会话内联执行）. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-09-21 专家门户全流程审查报告（`water-erp/docs/专家门户全流程功能审查报告-2026-09-21.md`）中的 3 个 P2 与 4 个 P3 缺陷，逐项浏览器/单测验证。

**Architecture:** 7 个独立小修（6 个代码修复 + 1 个数据/文案修复），按 P2→P3 顺序逐任务 TDD/浏览器验证，每任务一提交。不触碰并行会话文件（signin-camera.tsx 及 4 个 spec）。

**Tech Stack:** NestJS 11 + Prisma（apps/api，jest 单测）、Next.js 16 + React 19（apps/expert-portal，浏览器 MCP 验证）、chrome-devtools MCP 复验。

**Spec:** `water-erp/docs/专家门户全流程功能审查报告-2026-09-21.md` §二 缺陷清单 + §八 修复优先级。

## Global Constraints

- 只 add 明确改动文件路径，禁 `git add -A`（并行会话约定）。
- 提交信息 `fix(expert-portal):` / `fix(api):` 前缀，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；不主动 push。
- API 单测跑法：`pnpm --filter api test -- <pattern>`；改 schema 无涉（零迁移）。
- 浏览器验证基线：:3006 已登录覃克非（reportConfirmed=t 终态，正好用于 P2-1 验证）。
- 验证中改演示态的（组长指派、范鸿烨 signedIn 翻转）须复原或说明。

---

### Task 0: 计划入库

- [ ] 将本计划另存为 `water-erp/docs/superpowers/plans/2026-09-21-expert-portal-audit-fixes.md`（writing-plans 惯例位置），随 Task 1 一并提交

### Task 1（P2-1）报告确认后 canConfirm 永真 + 前端无已确认态

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:2116`（canConfirm 计算）
- Modify: `apps/expert-portal/src/components/evaluate/report-step.tsx`（props + 已确认态渲染）
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx:902-908`（handleConfirmReport 刷新）与 L2171-2178（传 prop）
- Test: `apps/api/src/expert/expert.service.spec.ts`（getReport canConfirm 用例）

**Interfaces:**
- Produces: `GET /expert/projects/:id/report` 响应中 `canConfirm` 在 `reportConfirmed=true` 时恒为 `false`
- Produces: `ReportStep` 新增可选 prop `reportConfirmed?: boolean`（默认 undefined 兼容旧调用）

**探索结论（回填）**：expert.service.spec.ts 现状**无任何 canConfirm 断言**（护栏空白）；现有 `describe('getReport')` 在 L536 与 L1352，mock 模式=顶部 beforeEach 手写 prisma 对象字面量（L15-113，fixture `mockExpert` L19-33），失败断言风格 `rejects.toMatchObject({ response: { code } })`。新用例挂进现有 `describe('getReport')`，参照 L536 用例构造 bidProject/bidExpert/bidScoreReview 的 mock 返回。

- [ ] **Step 1: 写失败单测**（getReport：mockExpert 置 `reportConfirmed: true, progress: 100`，评分核对全 verified → 断言返回 `canConfirm === false`；对照组 progress:100 未确认 → true）——测试名 `已确认报告后 canConfirm=false`
- [ ] **Step 2: 跑测试确认失败**：`pnpm --filter api test -- expert.service.spec` → 新用例 FAIL
- [ ] **Step 3: 服务端修复**

```ts
// expert.service.ts getReport 返回值（L2116 附近）
canConfirm: !expert.reportConfirmed && expert.progress >= 100 && allVerified,
```

- [ ] **Step 4: 跑测试通过**（既有 196 用例不回归）
- [ ] **Step 5: 前端 ReportStep**（report-step.tsx）：①props 接口加 `reportConfirmed?: boolean` 并解构；②action bar 确认按钮条件 `report?.canConfirm && !reportConfirmed`；③已确认时渲染成功徽标 `<span className="exp-pill exp-pill--solid" style={{'--c':'var(--success)'}}><Check size={11}/>评审报告已确认</span>`；④子标题 `{reportConfirmed ? '评审报告已确认，评分已锁定' : '查看评审结果汇总，确认后不可修改'}`
- [ ] **Step 6: evaluate page**：调用处（L2171-2178）传 `reportConfirmed={!!expert?.reportConfirmed}`（先例：VerifyScoreStep `locked={!!expert?.reportConfirmed}` L2164）；`handleConfirmReport`（L902-908）成功分支 `loadProject();` 后加 `loadReport();`
- [ ] **Step 7: 浏览器验证**：覃克非（已 reportConfirmed=t）打开向导 Step7 → 确认按钮消失、显示已确认徽标、子标题切锁定文案；刷新页面仍正确；无控制台错误
- [ ] **Step 8: 提交** `fix(expert): 报告确认后隐藏确认按钮并显示已确认态——canConfirm 补 reportConfirmed 闸门`

### Task 2（P2-2）个人资料空名假成功

**Files:**
- Modify: `apps/api/src/expert/dto/update-profile.dto.ts`（displayName 加 @IsNotEmpty）
- Modify: `apps/expert-portal/src/app/(app)/profile/page.tsx`（保存按钮 disabled + 错误提示，细节见探索结果）
- Test: 新建 `apps/api/src/expert/dto/update-profile.dto.spec.ts`（class-validator 直测）

**Interfaces:** Consumes `class-validator` 的 `validate()`；Produces 400「姓名不能为空」当 displayName=''。

**探索结论（回填）**：profile/page.tsx state `{ displayName, email }`（L30-32）；`handleSave`（L41-53）现状**零校验**、`catch { toast.error('更新失败') }` 连 e 都不接；保存按钮两处（L102/L172）仅 `disabled={saving}`。

- [ ] **Step 1: 失败测试**：`validate(new UpdateExpertProfileDto 实例 { displayName: '' })` → errors 非空；`{ email: 'bad' }` → errors 非空；`{ displayName: '张三', email: 'a@b.c' }` → 0 errors
- [ ] **Step 2-4: 红绿**：加 `@IsNotEmpty({ message: '姓名不能为空' })`（保留 @IsOptional）；service L126 `if (dto.displayName)` 改 `if (dto.displayName !== undefined)`
- [ ] **Step 5: 前端**（profile/page.tsx）：
```tsx
const emailValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
const canSave = form.displayName.trim().length > 0 && emailValid;
// L102/L172 两处按钮：disabled={saving || !canSave}
// 邮箱框下方行内提示：{!emailValid && <p className="text-xs font-semibold text-[var(--danger)]">邮箱格式不正确</p>}
// handleSave catch 改：catch (e: any) { toast.error(e.message || '更新失败'); }
```
- [ ] **Step 6: 浏览器验证**：清空姓名→保存禁用；填非法邮箱→行内提示+保存禁用；有效修改→「资料已更新」且 DB 变化；服务端 400 消息可透出（用 API 直接发空名验证）
- [ ] **Step 7: 提交** `fix(expert): 个人资料空名/坏邮箱保存假成功——DTO 必填校验+前端禁用+错误透出`

### Task 3（P2-3）/tasks 空态文案误导 + 英雄项目补组长

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/tasks/page.tsx:254,393`（空态文案按 isLeadAnywhere 分流）
- Modify: `apps/api/prisma/seed-data/BidExpert.json`（cmqhero-be01 周祥志 isLead→true）+ 当前 DB 同步 SQL

**Interfaces:** 服务端 createMotion/createDispute 均组长限定（expert.service.ts:2398/2468 `仅评审组长可...` NOT_LEAD）——非组长文案口径：「表决与异议由评审组长发起」。**全仓无任何写 isLead 的端点**（swapExpertRole 只翻 expertRole 不碰 isLead；签字包/评委会名单按 `isLead desc` 排序消费）——种子 JSON 是唯一组长效写点。

**探索结论（回填）**：种子文件 `apps/api/prisma/seed-data/BidExpert.json` 恰好 5 条全为英雄项目，全 `isLead:false`；seed.ts `createMany` 直写 JSON 字段（改 JSON 即可，无需动 seed.ts）。

- [ ] **Step 1: 文案分流**（tasks/page.tsx L254、L393 两处空态）：
  - lead：保持「点击『发起动议/提交异议』按钮新建」
  - 非 lead 动议：`表决动议由评审组长发起，投票开放后可在此参与`
  - 非 lead 异议：`异议工单由评审组长提交；如有评审异议请联系组长`
- [ ] **Step 2: 组长落位**：①`BidExpert.json` 中 `cmqhero-be01` 周祥志 `"isLead": false → true`（progress=100、aiConsentConfirmed=true，且避开并行会话用过的黃凯）；②当前库同步 `UPDATE "BidExpert" SET "isLead"=true WHERE id='cmqhero-be01';`（演示态与种子一致，db:seed 后仍在）
- [ ] **Step 3: 浏览器验证**：①覃克非（非组长）→ 新文案、无误导；②登录周祥志（密码 111111111111111111）→ 「发起动议」「提交异议」按钮出现、表单可开可取消；③tasks 刷新按钮正常
- [ ] **Step 4: 提交** `fix(expert): 评审待办空态文案按组长身份分流+种子补组长（周祥志）`

### Task 4（P3-1）开标消息 Esc 关闭

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（新增 Esc useEffect）

- [ ] **Step 1: 实现**（挂载模式对齐 confirm-dialog.tsx L31-50 惯例——条件挂载+卸载清理；两个弹窗都在本页，一个 effect 统一管）：

```tsx
useEffect(() => {
  if (!showMessages && !showClarifications) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setShowMessages(false); setShowClarifications(false); }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [showMessages, showClarifications]);
```

- [ ] **Step 2: 浏览器验证**：开标消息弹窗按 Esc 关闭；澄清答疑弹窗按 Esc 关闭；两者都关时不报错；Esc 不影响其他状态（备注抽屉/历史抽屉不误关——effect 只在两 flag 开时挂）
- [ ] **Step 3: 提交** `fix(expert): 开标消息/澄清弹窗支持 Esc 关闭（兑现文案承诺）`

### Task 5（P3-2）异常供应商打分输入置灰

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` 打分渲染块（L~1865 `<div className="space-y-6">`）

- [ ] **Step 1: 实现**（对齐页内既有置灰惯用语 `'pointer-events-none select-none opacity-50'`——身份核验 L1479/L1534/L1592 三处同款）：打分渲染块 IIFE 外层 `<div className="space-y-6">` 改：

```tsx
<div className={`space-y-6 ${!canScoreActiveSupplier && !scoreLocked ? 'pointer-events-none select-none opacity-50' : ''}`}>
```

（含已声明回避/已废标供应商；汇总卡一并置灰——其提交本就禁用；`canScoreActiveSupplier` 在 L1088 已计算，闭包可用）
- [ ] **Step 2: 浏览器验证**：切到四川省通信产业（异常）→ 全部输入不可交互、置灰；切回正常供应商 → 恢复
- [ ] **Step 3: 提交** `fix(expert): 不可评供应商打分区整卡置灰防白填`

### Task 6（P3-3）roomCodeAt NULL 口令闸死锁加固

**Files:**
- Modify: `apps/api/src/expert/expert-room.util.ts:84`
- Modify: `apps/api/src/expert/expert.service.ts:393-395`（roomCodeVerified 同口径）
- Test: 新建 `apps/api/src/expert/expert-room.util.spec.ts`（直测 util，最小 stub prisma）

**探索结论（回填）**：全仓 roomCodeVerified 仅 expert.service.ts:391-395 一处赋值；roomCodeAt 写点仅 `bid.service.ts:2104`（startEvaluation）与 `:3123-3144`（rotateRoomCode），**均原子成对写**——null 态只来自手工改库/漂移，加固安全。util 为共享件：expert-memo.service.ts 四处直接消费 assertRoomUnlocked，改 util 自动覆盖；单测层现状零覆盖（全在 test/expert-room-window.e2e-spec.ts 16 例），新建 util 直测不需 DI：

```ts
import { assertRoomUnlocked } from './expert-room.util';
// stub: { bidProject: { findUnique: async () => ({ stage:'EVALUATING', roomCode:'X', roomCodeAt: null }) },
//         bidExpert: { findFirst: async () => ({ roomVerifiedAt: new Date() }) } }
```

- [ ] **Step 1: 失败测试**（三例）：①roomCode 有 + roomCodeAt **null** + roomVerifiedAt 有 → **不抛**（当前实现抛=红）；②roomCodeAt 有值 + roomVerifiedAt 早于它 → 抛 `ROOM_CODE_REQUIRED`；③roomCode 空 → 放行（旧行为回归护栏）
- [ ] **Step 2-4: 红绿**：`expert-room.util.ts:84` 与 `expert.service.ts:395` 两处 `!!project.roomCodeAt && …>= roomCodeAt` → `(!project.roomCodeAt || …>= roomCodeAt)`（同步改 L391 注释）
- [ ] **Step 5: 跑既有测试无回归**：`pnpm --filter api test -- expert.service.spec`（c6e312bb 后该 spec 196 例为新基线）
- [ ] **Step 6: 浏览器验证**：SQL 设 `roomCode='AUDIT002'` **不带** roomCodeAt（复现审计死锁场景）→ 覃克非门页输入 AUDIT002 验证 → 门页清除、向导可用（修复前此处死锁：验证成功仍 403）；结束后 `roomCode=NULL` + attempts 归零复原
- [ ] **Step 7: 提交** `fix(api): 评标室口令闸 roomCodeAt 空值不再死锁——已验证即放行（util+派生双处同口径）`

### Task 7（P3-4）未签到 my-scores 403 噪音

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` loadProject 内 my-scores 调用（L~327）

- [ ] **Step 1: 实现**：`if (p.myExpertRecord?.signedIn) { api.get(...my-scores)... }`（未签到时评分区本就锁定，无数据可 hydrate）。注：该 403 实为 `VERIFICATION_REQUIRED`（expert.service.ts:1710-1712 五条件任一未满足），服务端闸门保留作纵深防御，仅前端跳过调用消噪
- [ ] **Step 2: 浏览器验证**：临时置范鸿烨 signedIn=false → 登录范鸿烨进向导 → network 无 my-scores 请求、无 409/403 控制台红 → 复原 signedIn=true
- [ ] **Step 3: 提交** `fix(expert): 未签到专家跳过 my-scores 拉取消除 403 噪音`

---

## 收尾验证（全任务后）

1. `pnpm --filter api test -- expert` 全绿 + `pnpm --filter api lint` 无新告警
2. `pnpm --filter expert-portal lint`（或既有 lint 命令）通过
3. 浏览器全链复走：覃克非 Step7 已确认态 / tasks 文案 / 打分置灰 / Esc 关闭 / 控制台无新错
4. 汇总修复结果对照审查报告 §八，更新报告状态列（已修/验证）
5. 提醒用户未推送；演示数据缺口（AI 任务/deadline/签字包）仍待另办
