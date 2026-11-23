# 条款响应核对·右栏计算器 v1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 :3006 桌面端「条款响应核对」右栏 header 加计算器按钮 + 锚定 popover，纯前端通用四则计算器。

**Architecture:** 纯函数状态机（`calculator-core.ts`，reducer + 键盘映射）+ 常驻挂载的 React popover 组件（`CalculatorPopover`）+ 右栏 header 一行集成。零后端、零新依赖。

**Tech Stack:** React 19 + Tailwind v4 + cgzxui 类体系；测试 Node 内置 `node --test`（纯函数层）。

**Spec:** `docs/superpowers/specs/2026-11-20-expert-compare-calculator-design.md`

## Global Constraints

- 所有路径相对 `water-erp/`；工作区 = worktree `.worktrees/expert-compare-calculator`（分支 `feat/expert-compare-calculator`）
- 不新增 npm 依赖；不改后端
- 测试约定：`node:test` + `assert/strict`，从测试文件**相对导入带 `.ts` 扩展名**（如 `from '../calculator-core.ts'`）；跑法 `pnpm --filter expert-portal test`（在 apps/expert-portal 下 `pnpm test` 同义）
- UI 一律 cgzxui 类（neu-btn-xs / neu-card-static 等 + 门户 oklch 令牌），数字 `font-mono tabular-nums`；写 UI 前调用 `water-erp:cgzxui` 技能
- 提交只 add 本计划点名的文件（多会话共库禁 `git add -A`）；commit 尾注 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；**不 push**（用户验收后定）
- 每任务收尾验证：`pnpm exec tsc --noEmit`（apps/expert-portal 下）零输出

## Review Focus

1. **键盘 `/` 与 Backspace 触发浏览器行为**（快速查找/历史导航）——计算器处理时必须 `preventDefault()`（Task 2）
2. **Escape 双杀**：popover 的 Escape 若不 `stopPropagation()` 会同时退出面板全屏（window 监听，`requirement-compare-panel.tsx:123-128`）——Task 2 必须只关计算器
3. **浮点噪声**：0.1+0.2 显示 0.30000000000000004——Task 1 精度测试钉死 `toPrecision(12)`
4. **超长输入**：连按数字无上限会撑破显示——Task 1 钉死 15 字符上限
5. **除零后死锁**：报错态若不接受新输入，专家只能刷新——Task 1 钉死「错误态 digit 自愈」

---

### Task 1: calculator-core 纯函数状态机

**Files:**
- Create: `apps/expert-portal/src/lib/calculator-core.ts`
- Test: `apps/expert-portal/src/lib/__tests__/calculator-core.test.ts`

**Interfaces:**
- Consumes: 无（纯 TS，无 React/DOM）
- Produces（Task 2 消费，签名逐字照抄）:

```ts
export type CalcOp = '+' | '-' | '×' | '÷';
export interface CalcHistoryEntry { expr: string; result: string }
export interface CalcState {
  display: string;          // 原始数字串（无千分位、无单位）
  acc: number | null;       // 左操作数累积
  pendingOp: CalcOp | null; // 待应用运算符
  lastOperand: number | null; // 上次 = 的右操作数（重复 = 复用）
  freshEntry: boolean;      // true=下个 digit 重新起数
  error: string | null;     // '除数不能为 0'
  history: CalcHistoryEntry[]; // 新的在前，≤5 条
}
export type CalcAction =
  | { type: 'digit'; d: '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9' }
  | { type: 'dot' } | { type: 'op'; op: CalcOp } | { type: 'equals' }
  | { type: 'percent' } | { type: 'negate' } | { type: 'backspace' }
  | { type: 'clear' } | { type: 'useHistory'; value: string };
export const initialCalcState: CalcState;
export function calcReducer(state: CalcState, action: CalcAction): CalcState;
export function keyToAction(key: string): CalcAction | null;  // 无映射返回 null（Escape 亦 null，组件自行关弹层）
export function formatCalcDisplay(raw: string): string;       // 千分位：'1234567.89'→'1,234,567.89'
```

**语义裁定（与 spec 一致，测试钉死）：** `%`=当前值÷100；连按 `=` 重复上次运算；`C` 重置运算态但**保留 history**；错误态仅 `digit`/`clear` 有效（digit=重新起数）；`backspace` 在 freshEntry 态为 no-op；精度 `Number(v.toPrecision(12))` 后 `String()` 回写；display 输入长度上限 15 字符（超出忽略）。

- [ ] **Step 1: 写失败测试**（`calculator-core.test.ts`，一个 test 一语义，用 `calcReducer(initialCalcState, …)` 序列驱动后断言 `state.display`/`state.error`/`state.history`）：

  1. `'digit 输入与Leading零：0→5→显示5；连续0仍0'`
  2. `'dot：5→"5."；freshEntry 后 dot→"0."；二个 dot 忽略'`
  3. `'op 链式即时执行：2+3 后按 × → display=5, pendingOp=×'`
  4. `'equals：2+3= → 5，history[0]={expr:"2 + 3", result:"5"}'`
  5. `'连按 = 重复上次运算：5+3= → 8，再 = → 11'`
  6. `'percent：1500 × 5 % → display=0.05，再 = → 75'`
  7. `'除零：5÷0= → error="除数不能为 0"；随后 digit 7 自愈 display=7、error=null'`
  8. `'negate：5 → -5；freshEntry 态对结果取负仍 freshEntry'`
  9. `'backspace："123"→"12"→"1"→"0"；freshEntry 态 no-op'`
  10. `'clear：运算态全重置，history 保留'`
  11. `'精度：0.1+0.2= → "0.3"'`
  12. `'输入上限：16 位数字第 16 个被忽略'`
  13. `'useHistory："5" 回填 display=5、freshEntry=true'`
  14. `'keyToAction：数字/./+ - * x //Enter/=/Backspace/c/C/% 全映射正确，Escape 与无关键返回 null'`
  15. `'formatCalcDisplay："1234567.89"→"1,234,567.89"，"-0.5" 原样'`

- [ ] **Step 2: 跑测试确认失败**：`cd apps/expert-portal && pnpm test` → 新文件全部 ERR_MODULE_NOT_FOUND（calculator-core 不存在），存量 45 项照常绿
- [ ] **Step 3: 实现 `calculator-core.ts`**——经典即时执行状态机一个 `switch(action.type)`；历史 unshift 后 `slice(0,5)`；运算用 `toPrecision(12)` 归一。除 `initialCalcState` 常量与四个导出函数外不导出其他
- [ ] **Step 4: 跑测试确认通过**：`pnpm test` → 全绿（45 存量 + 15 新增）
- [ ] **Step 5: 提交**

```bash
git add apps/expert-portal/src/lib/calculator-core.ts apps/expert-portal/src/lib/__tests__/calculator-core.test.ts
git commit -m "feat(expert-portal): 计算器核心状态机（纯函数+键盘映射，node --test 15 例）"
```

---

### Task 2: CalculatorPopover 组件

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/calculator-popover.tsx`

**Interfaces:**
- Consumes: Task 1 全部导出（签名见上）；lucide-react `Calculator`（已验证存在）
- Produces: `export function CalculatorPopover({ className = '' }: { className?: string }): JSX.Element`——自含触发按钮与弹层，无其他 props

**结构（无 React 测试基建，本任务验证=tsc + Task 3 集成后人工/浏览器验收）：**
- 常驻挂载：`useReducer(calcReducer, initialCalcState)` + `open` 布尔；开合不丢状态/历史（切供应商面板重挂载即整体重置，符合 spec）
- 触发按钮：`neu-btn-xs is-square` + `Calculator` 图标 15px/1.5 + `title="计算器"` + `aria-expanded`/`aria-haspopup="dialog"`
- 弹层：外层 `relative`（包触发按钮）；弹层 `absolute right-0 top-full mt-2 z-30 w-[240px]`，卡片用 cgzxui 静态容器类（**实现前调 water-erp:cgzxui 技能定类**）；内容三段——① 待算式行（`acc op` 小字 10px muted font-mono，空则不显）② 主显示（`formatCalcDisplay(display)` 右对齐 font-mono tabular-nums text-lg；error 时红字显 error 文案）③ 键区 5×4 网格：`C ⌫ % ÷ / 7 8 9 × / 4 5 6 − / 1 2 3 + / ± 0 . =`
- 历史条（有 history 时，显示区与键区之间）：≤5 行 `expr = result` 10px，点击 `dispatch({type:'useHistory', value})`，hover 提示「点击回填」
- 键盘：弹层容器 `tabIndex={-1}`，open 时 `ref.current?.focus()`；`onKeyDown` 走 `keyToAction(e.key)`——非 null `preventDefault()+stopPropagation()+dispatch`；`Escape` 仅 `stopPropagation()` 后关弹层（防全屏双杀）；**焦点不在弹层内不劫持键盘**（不加 window 监听）
- 点外关闭：`useEffect`（open 时挂）document `pointerdown`，`!rootRef.current.contains(e.target)` 则关

- [ ] **Step 1: 调用 `water-erp:cgzxui` 技能**获取按钮/卡片正确类名与禁则
- [ ] **Step 2: 实现组件**（结构如上；无 mock 数据、无console 噪音）
- [ ] **Step 3: 类型验证**：`cd apps/expert-portal && pnpm exec tsc --noEmit` → 零输出（组件暂无人引用，tsc 仍会检查文件本身）
- [ ] **Step 4: 提交**

```bash
git add apps/expert-portal/src/components/evaluate/calculator-popover.tsx
git commit -m "feat(expert-portal): 计算器 popover 组件——右栏锚定/键盘输入/历史回填/点外关闭"
```

---

### Task 3: 集成右栏 header + 全量验证

**Files:**
- Modify: `apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx`（右栏 header，现行 507-513 行）

**Interfaces:**
- Consumes: Task 2 `CalculatorPopover`
- Produces: 无（终点）

- [ ] **Step 1: 集成**——header 标题行加 `<CalculatorPopover className="ml-auto" />`；顶部补 import。目标形态：

```tsx
<header className="shrink-0 border-b border-[oklch(0.6_0.04_258/0.12)] px-3 py-2.5">
  <div className="flex items-center gap-1.5">
    <FileText size={13} strokeWidth={1.5} className="shrink-0 text-[var(--accent-strong)]" />
    <span className="text-sm font-bold text-[var(--foreground)]">响应与标注</span>
    <CalculatorPopover className="ml-auto" />
  </div>
</header>
```

- [ ] **Step 2: 全量验证**：`pnpm test` 全绿 + `pnpm exec tsc --noEmit` 零输出
- [ ] **Step 3: 设计文档回执**——spec 文件追加「实施于 feat/expert-compare-calculator（2026-11-20）」一行
- [ ] **Step 4: 提交**

```bash
git add apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx docs/superpowers/specs/2026-11-20-expert-compare-calculator-design.md docs/superpowers/plans/2026-11-20-expert-compare-calculator.md
git commit -m "feat(expert-portal): 条款响应核对右栏接入计算器入口（header 常驻+spec/plan 归档）"
```

---

## 验收（用户）

- `git log --oneline main..feat/expert-compare-calculator` 应见 3 个提交
- 浏览器验收（主工作区 dev :3006 已在跑，合并前可先在 worktree 单独起 dev 或由用户在验收时合并到本地 main 再看）
