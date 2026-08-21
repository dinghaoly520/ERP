# 截标↔开标 24h 关系规范化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把全链路四种「截标↔开标」口径（向导 24h 派生 / 开标确认面板展示 12h / 演示脚本 −1h / 重启兜底 +2h、公告直建缺省 +7 天）统一为单一权威常量「截标 = 开标前 24 小时」，服务层全写路径强校验（截标前 align ±1min、截标后 deadline 冻结仅 openTime 可延）。

**Architecture:** `packages/shared` 新增常量；API 新增纯函数 `opening-deadline.util.ts`（align/frozen 校验 + 双向派生）；四个写路径（createBidProject/createFromAnnouncement/reopenFromAborted/updateProject）接入；存量由 tsx 迁移脚本统一（未截标行才改）；前端把 12h 展示改为共享常量 24h。

**Tech Stack:** NestJS 11 + Prisma（API）；Next.js 16（web :3005）；pnpm workspace；tsx 脚本。

**Spec:** `water-erp/docs/superpowers/specs/2026-08-21-opening-deadline-24h-alignment-design.md`（§3.2 写路径表/§7 测试为权威）

## Global Constraints

- **workspace 包**：改 `packages/shared` 后必须 `pnpm --filter @water-erp/shared build`；web 消费它需重启 dev server。
- **迁移脚本**：tsx 无 Nest 依赖（memory `nest-tsx-script-gotchas`）；dry-run 默认零副作用；`--execute` 逐条失败隔离；dev 库 dry-run 输出贴报告，**不主动 --execute**。
- **错误形状**：`BadRequestException({ error, code })`；单测 `.rejects.toMatchObject({ response: { code } })`。
- **不主动 push**；commit 前查分支。
- **验证命令**：API `pnpm --filter api test -- <pattern>`；web `npx tsc --noEmit`（apps/web 下）。
- 常量名/值逐字：`BID_DEADLINE_BEFORE_OPENING_MS = 24 * 3_600_000`、`BID_OPENING_GAP_TOLERANCE_MS = 60_000`；错误码 `DEADLINE_OPENING_GAP_INVALID`（align 不符，error 含期望值）/ `DEADLINE_FROZEN`（截标后改 deadline）。

---

### Task 1: shared 常量 + opening-deadline.util（纯函数 + 单测）

**Files:**
- Modify: `packages/shared/src/constants.ts`（追加两常量，注释按 spec §2.1 全文）
- Create: `apps/api/src/bid/opening-deadline.util.ts`、`apps/api/src/bid/opening-deadline.util.spec.ts`

**Interfaces:**
- Consumes: `@water-erp/shared` 两常量。
- Produces（后续任务依赖，签名锁定）:
  - `type DeadlineOpenMode = 'align' | 'frozen'`
  - `assertOpeningDeadlineRelation(opts: { openTime: Date; deadline: Date; prev?: { openTime: Date; deadline: Date }; mode: DeadlineOpenMode }): void`
  - `deriveDeadlineFromOpenTime(openTime: Date): Date`（= openTime − 24h）
  - `deriveOpenTimeFromDeadline(deadline: Date): Date`（= deadline + 24h）
  - `modeFor(prevDeadline: Date | undefined, now?: Date): DeadlineOpenMode`（prevDeadline 已过 → 'frozen'，否则 'align'）

- [ ] **Step 1: shared 常量**

`packages/shared/src/constants.ts` 末尾追加（注释全文照 spec §2.1）:
```ts
/** 截标↔开标业务规则：投标截止 = 开标前 24 小时（集团采购业务规则·内部惯例）。
 * 留痕：与《招标投标法》第34条「开标应当在提交投标文件截止时间的同一时间公开进行」
 * 存在偏离——依据为集团采购业务规则（内部惯例，无成文条款）；对依法必须招标项目
 * 存在程序瑕疵风险，待制度成文化后更新本引用与 UI 文案。 */
export const BID_DEADLINE_BEFORE_OPENING_MS = 24 * 3_600_000;
/** 截标↔开标关系校验的分钟级容差 */
export const BID_OPENING_GAP_TOLERANCE_MS = 60_000;
```
`pnpm --filter @water-erp/shared build` 并确认 dist 含新导出。

- [ ] **Step 2: 失败测试（opening-deadline.util.spec.ts）**

```ts
import {
  assertOpeningDeadlineRelation, deriveDeadlineFromOpenTime, deriveOpenTimeFromDeadline, modeFor,
} from './opening-deadline.util';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';

describe('opening-deadline.util', () => {
  const base = new Date('2026-09-01T10:00:00Z');

  it('align：合规（deadline = openTime − 24h）不抛', () => {
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS), mode: 'align',
    })).not.toThrow();
  });
  it('align：差 23h → DEADLINE_OPENING_GAP_INVALID 且 error 含期望值', () => {
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(base.getTime() - 23 * 3_600_000), mode: 'align',
    })).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_OPENING_GAP_INVALID' }) }));
  });
  it('align：差 25h → 同码', () => { /* 同上结构，deadline = openTime − 25h */ });
  it('align：±1min 容差边界（差 24h+50s → 合规；差 24h+70s → 400）', () => {
    const ok = new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS - 50_000);
    const bad = new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS - 70_000);
    expect(() => assertOpeningDeadlineRelation({ openTime: base, deadline: ok, mode: 'align' })).not.toThrow();
    expect(() => assertOpeningDeadlineRelation({ openTime: base, deadline: bad, mode: 'align' })).toThrow();
  });
  it('derive 双向：roundtrip（deriveDeadlineFromOpenTime → deriveOpenTimeFromDeadline 回原值）', () => {
    expect(deriveOpenTimeFromDeadline(deriveDeadlineFromOpenTime(base)).getTime()).toBe(base.getTime());
  });
  it('frozen：deadline 传值与 prev 不同 → DEADLINE_FROZEN', () => {
    const prev = { openTime: base, deadline: new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS) };
    expect(() => assertOpeningDeadlineRelation({
      openTime: base, deadline: new Date(prev.deadline.getTime() + 1), prev, mode: 'frozen',
    })).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_FROZEN' }) }));
  });
  it('frozen：openTime < deadline + 24h → DEADLINE_OPENING_GAP_INVALID；openTime 延后合规', () => {
    const prev = { openTime: base, deadline: new Date(base.getTime() - BID_DEADLINE_BEFORE_OPENING_MS) };
    expect(() => assertOpeningDeadlineRelation({
      openTime: new Date(base.getTime() + 3_600_000), deadline: prev.deadline, prev, mode: 'frozen',
    })).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'DEADLINE_OPENING_GAP_INVALID' }) }));
    expect(() => assertOpeningDeadlineRelation({
      openTime: new Date(base.getTime() + 2 * BID_DEADLINE_BEFORE_OPENING_MS), deadline: prev.deadline, prev, mode: 'frozen',
    })).not.toThrow();
  });
  it('modeFor：prev.deadline 已过 → frozen；未过/无 prev → align', () => {
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    expect(modeFor(past)).toBe('frozen');
    expect(modeFor(future)).toBe('align');
    expect(modeFor(undefined)).toBe('align');
  });
});
```

- [ ] **Step 3: 跑测试确认 RED**（模块不存在）
- [ ] **Step 4: 实现 util**

```ts
import { BadRequestException } from '@nestjs/common';
import { BID_DEADLINE_BEFORE_OPENING_MS, BID_OPENING_GAP_TOLERANCE_MS } from '@water-erp/shared';

export type DeadlineOpenMode = 'align' | 'frozen';

export function deriveDeadlineFromOpenTime(openTime: Date): Date {
  return new Date(openTime.getTime() - BID_DEADLINE_BEFORE_OPENING_MS);
}
export function deriveOpenTimeFromDeadline(deadline: Date): Date {
  return new Date(deadline.getTime() + BID_DEADLINE_BEFORE_OPENING_MS);
}
export function modeFor(prevDeadline: Date | undefined, now: Date = new Date()): DeadlineOpenMode {
  return prevDeadline && prevDeadline.getTime() < now.getTime() ? 'frozen' : 'align';
}

export function assertOpeningDeadlineRelation(opts: {
  openTime: Date; deadline: Date; prev?: { openTime: Date; deadline: Date }; mode: DeadlineOpenMode;
}): void {
  const { openTime, deadline, prev, mode } = opts;
  if (mode === 'frozen') {
    if (prev && deadline.getTime() !== prev.deadline.getTime()) {
      throw new BadRequestException({ error: '截标时间已固化，不得变更', code: 'DEADLINE_FROZEN' });
    }
    if (openTime.getTime() < deadline.getTime() + BID_DEADLINE_BEFORE_OPENING_MS) {
      throw new BadRequestException({
        error: `开标时间须不早于截标后 24 小时（期望 ≥ ${deriveOpenTimeFromDeadline(deadline).toISOString()}）`,
        code: 'DEADLINE_OPENING_GAP_INVALID',
      });
    }
    return;
  }
  const expected = deriveDeadlineFromOpenTime(openTime).getTime();
  if (Math.abs(deadline.getTime() - expected) > BID_OPENING_GAP_TOLERANCE_MS) {
    throw new BadRequestException({
      error: `截标须为开标前 24 小时（期望 deadline = ${new Date(expected).toISOString()}）`,
      code: 'DEADLINE_OPENING_GAP_INVALID',
    });
  }
}
```

- [ ] **Step 5: GREEN（util spec 全过）+ shared build**
- [ ] **Step 6: Commit** `feat(bid): 截标↔开标 24h 关系 util 与共享常量（align/frozen 分阶段校验）`

### Task 2: 服务层四写路径接入 + 单测

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（createBidProject ~:633 / createFromAnnouncement ~:664-731 / updateProject ~:760-770 / reopenFromAborted ~:1197）
- Test: `apps/api/src/bid/bid.service.spec.ts`（新 describe「截标↔开标 24h」）

**Interfaces:**
- Consumes: Task 1 util/常量。
- Produces: 四路径行为（锁定）：
  - `createBidProject`：dto 双字段均提供 → `assertOpeningDeadlineRelation({ mode:'align' })`；缺 deadline → `deadline = deriveDeadlineFromOpenTime(openTime)`；缺 openTime 缺 deadline → 原兜底不动（报告说明）。
  - `createFromAnnouncement`：`metadata.deadline` 缺省 → derive from openTime（**替换现 +7 天兜底**）；提供 → align 校验（openTime 按现 parseFlexibleDate 逻辑确定后）；:723-731 的 sync 覆盖段保持「parsedDeadline < openTime 才覆盖」方向不变，覆盖时用 derive。
  - `reopenFromAborted`：`deadline = now + 3 天`、`openTime = deriveOpenTimeFromDeadline(deadline)`（替换现 +2h）。
  - `updateProject`：解析 dto 后，`mode = modeFor(prev.deadline)`；align：仅传 openTime → deadline=derive；仅传 deadline → openTime=derive；双传 → align 校验；frozen：dto.deadline 提供且 ≠ prev.deadline → `DEADLINE_FROZEN`；dto.openTime 提供 → 按 frozen 校验（deadline 用 prev.deadline）。
  - 延时开标路径（web updateBidProjectSchedule → PATCH openTime）自动落入 updateProject frozen 分支，无需单独端点改动。

- [ ] **Step 1: 失败测试（bid.service.spec 新 describe）**

```ts
describe('截标↔开标 24h（P0-2）', () => {
  // mock 复用既有 spec 的 prisma/service 骨架；openTime/deadline 用固定时间
  const OPEN = new Date('2026-09-01T10:00:00Z');
  const DEADLINE = new Date(OPEN.getTime() - 24 * 3_600_000);

  it('createBidProject：双字段合规落库', async () => { /* dto { openTime, deadline } 关系合规 → prisma.bidProject.create 被调且 deadline 值不变 */ });
  it('createBidProject：差 23h → DEADLINE_OPENING_GAP_INVALID 且 create 零调用', async () => { /* deadline=OPEN−23h */ });
  it('createBidProject：缺 deadline → 自动派生 24h', async () => { /* dto 无 deadline → create 入参 deadline = OPEN−24h */ });
  it('createFromAnnouncement：metadata.deadline 缺省 → 派生（不再 +7 天）', async () => { /* create 入参 deadline == openTime−24h */ });
  it('createFromAnnouncement：提供 deadline 且差 25h → 400', async () => {});
  it('reopenFromAborted：兜底 deadline=+3天、openTime=deadline+24h', async () => { /* 断言 create 入参两字段差 = 24h 且 openTime>deadline */ });
  it('updateProject align：仅传 openTime → deadline 自动派生', async () => { /* prev.deadline 未过；update 入参 deadline == 新openTime−24h */ });
  it('updateProject align：双传差 23h → 400 且 update 零调用', async () => {});
  it('updateProject frozen：改 deadline → DEADLINE_FROZEN；仅延 openTime（≥+24h）→ 放行且 deadline 不变', async () => { /* prev.deadline 已过 */ });
  it('updateProject frozen：openTime < deadline+24h → DEADLINE_OPENING_GAP_INVALID', async () => {});
});
```
（每条用例按既有 mock 骨架补齐 prisma.bidProject.findUnique（返回 prev）/create/update 的 mock；断言 `.rejects.toMatchObject({ response: { code } })` 与零调用。）

- [ ] **Step 2: RED** → **Step 3: 实现**（按 Interfaces 锁定行为；createFromAnnouncement 的 openTime 解析顺序保持现逻辑，仅在 deadline 缺省/校验处接入 util）→ **Step 4: GREEN + 全量回归** `pnpm --filter api test -- bid.service` → **Step 5: Commit** `feat(bid): 四写路径接入 24h 关系校验（创建/直建/重启/修改+延时开标冻结）`

### Task 3: 存量迁移脚本 + 演示脚本/快照对齐

**Files:**
- Create: `apps/api/scripts/align-opening-deadline-24h.ts`
- Modify: `scripts/demo-decrypt-project.js`（:117-118、:226-227 的 `- 3600_000` → `- 24 * 3600_000`，注释指向共享常量口径）

**Interfaces:**
- Consumes: Task 1 常量（脚本经 `@water-erp/shared` dist 或直接字面量 24 * 3_600_000——tsx 脚本 import workspace 包需先 build，报告说明所选方式）。
- 脚本行为（锁定）：查 `bidProject.findMany({ select: { id, projectCode, name, openTime, deadline, stage } })` → **deadline > now** 且 `|deadline − (openTime − 24h)| > 60s` 的行 → dry-run 逐行输出 `{ projectCode, name, stage, 现 openTime, 现 deadline, 目标 deadline }` + 分区计数（待修正/已截标不动/已合规）；`--execute` → `update({ deadline: deriveDeadlineFromOpenTime(openTime) })` 逐条 try/catch 失败隔离；openTime 为基准不动。
- 快照检查：`scripts/snapshots/BID-DEMO-20260817150148-pre-open.json` 中 BidProject 的 openTime/deadline 差——若非 24h 且 deadline 未过 → 修正（快照为演示基准，修后无需重拍其他内容）；报告贴前后值。

- [ ] **Step 1: 写脚本**（照 clean-legacy-plaintext 模式：.env 自加载、dry-run 默认、`--execute` 横幅）→ **Step 2: dev 库 dry-run**（输出摘要贴报告；**不 --execute**）→ **Step 3: demo 脚本两处 −1h → −24h + 快照检查修正** → **Step 4: 语法验证**（esbuild parse 或 tsx 空跑 dry-run 已覆盖）→ **Step 5: Commit** `chore: 存量截标↔开标差值 24h 迁移脚本与演示脚本/快照对齐`

### Task 4: 前端展示与提示对齐（web :3005）

**Files:**
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`（:400-402 submitDeadline 派生 12h → `BID_DEADLINE_BEFORE_OPENING_MS`；:558 标题文案 12→24h + 注释引用共享常量；延时开标弹窗（~:378 区域）注明「截标已固化，仅推迟开标」）
- Modify: `apps/web/src/components/projects/announcement-publish-wizard.tsx`（两处 `24` 魔法值（:100、:449）改为引用共享常量——若 web 已 import shared 则直接用，否则在组件顶部 `import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared'` 并 `/ 3_600_000` 换算，注释说明）

**Interfaces:** 无新接口。

- [ ] **Step 1: bid-confirm-panel 三处** → **Step 2: wizard 两处魔法值常量化** → **Step 3: `npx tsc --noEmit`（apps/web）0 新错** → **Step 4: Commit** `feat(web): 截标↔开标 24h 展示口径统一（共享常量）与延时开标冻结提示`

### Task 5: 验收——全量测试 + e2e 冒烟 + 文档收尾

- [ ] **Step 1: 全量单测** `pnpm --filter api test`（全绿，含 Task 1/2 新用例）
- [ ] **Step 2: e2e 冒烟**（worktree 分支 API :4002 起实例，参照双信封冒烟模式；或复用 dev :4001 若其已重启）：①建项目（向导/API）→ 落库 deadline == openTime − 24h ②延时开标 PATCH openTime → deadline 不变且 ≥ +24h 放行 ③改 deadline → 400 DEADLINE_FROZEN ④流标重启 → +24h 兜底。输出贴报告。
- [ ] **Step 3: CLAUDE.md 补充**（Bash 追加）：§Bid Stage 区域或运维段加「截标↔开标 24h 业务规则（内部惯例，第34条偏离留痕）——常量 `BID_DEADLINE_BEFORE_OPENING_MS`、校验 util `opening-deadline.util.ts`、迁移脚本 `align-opening-deadline-24h.ts`」一句。
- [ ] **Step 4: spec 状态改「已实施」** → **Step 5: Commit** `docs: P0-2 落地文档与 spec 状态`

---

## Self-Review 记录

1. **Spec 覆盖**：§2 常量→T1；§3.1 util→T1；§3.2 四路径→T2；§4 迁移/快照/演示脚本→T3；§5 前端→T4；§7 测试+e2e→T1/T2/T5；§8 风险留痕→T1 注释+T5 文档。无缺口。
2. **占位符扫描**：无 TBD；Task 2 测试块内「同上结构」标注了结构来源（util spec 同型），属指引非占位。
3. **类型一致性**：util 三函数签名在 T1 定义、T2/T3 消费处一致；常量名与 spec §2.1 逐字；错误码三处一致。
4. **已知口径**（实现者注意）：wizard 已 24h 派生（:100/:449）——T4 只做常量化不动行为；supplier-portal 无派生逻辑（grep 空）不涉及。
