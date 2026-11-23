# 条款响应核对·右栏计算器（v1 通用版）设计

日期：2026-11-20 · 状态：已批准（用户裁定：v1 通用版、方案 A+1、独立分支实施）
分支：`feat/expert-compare-calculator`（worktree `.worktrees/expert-compare-calculator`，基于 main@738d2734b）
实施于 feat/expert-compare-calculator（2026-11-20）：三提交——calculator-core 状态机（15 例 node --test）→ CalculatorPopover（portal 定位裁定：右栏 overflow-hidden/15% 最窄会裁切 absolute 锚定，改 createPortal+fixed，SearchSelect 先例）→ 右栏 header 集成。

## 意图（why）

专家在 :3006 桌面端「条款响应核对」三栏面板中核对商务/技术条款时需要随手算术（百分比、限价比例、部分得分累加），评标环境不便切出页面。在右栏加一个常驻「计算器」入口，点开即算、不离开核对上下文。

## 目标

- 右栏（响应与标注）header 标题行右侧一个计算器图标按钮，点击展开锚定 popover 小卡（~240px）
- 标准四则 + 百分比 + 正负号 + 退格 + 清零 + 键盘输入 + 最近 5 条历史（点击回填结果）
- 纯前端、零后端、零数据落库（不进审计面）；不新增 npm 依赖

## 非目标（v1 不做）

- 评标专用测算（价格分公式/加权得分——留 v2，若需求出现）
- 复制结果到剪贴板（expert-portal 无 copy-to-clipboard util，引入需按 CLAUDE.md 门户自包含约定新放一份，v2 再议）
- 平板端（平板无核对步骤）；历史持久化（组件内存态，随面板生命周期）

## 反目标

- 遮挡中栏投标原文（modal/抽屉形态否）
- 引入表达式解析器/eval（经典计算器状态机足够，且可测）

## 约束

- cgzxui 设计体系（neu-btn-xs / neu-card-static / wb-panel 等，monospace tabular-nums 数字）
- 键盘事件不能与面板级 Escape（全屏退出，window 监听）冲突——popover 内 Escape 要 stopPropagation
- 右栏可缩至 15% 宽——popover 锚定 header 按钮、右对齐展开，不随栏宽挤压
- 测试走 expert-portal 既有 `node --test`（`src/lib/__tests__/*.test.ts`，node:test + assert/strict + 相对 .ts 导入）

## 方案取舍（对话已裁定）

位置：**A. 右栏 header 标题行右侧**（固定可见、不占三功能区）> B. 评分进度区（会滚走）> C. 底部提示行（可能被挤掉）。
形态：**1. 锚定 popover 小卡**（不遮原文）> 2. 可拖拽浮动面板（代码翻倍）> 3. 右抽屉（盖住右栏自身）> 4. 居中 modal（挡视线）。

## 实现要点（how）

1. **`src/lib/calculator-core.ts`**（纯函数、无 React）：经典计算器状态机 reducer——
   - 状态 `{ display, acc, pendingOp, lastOperand, freshEntry, error, history }`；动作 digit/dot/op/equals/percent/negate/backspace/clear
   - 语义裁定：`%` = 当前值÷100（乘法场景主导：1500×5%=75）；除零 → error 态「除数不能为 0」，下一次输入自愈；连按 `=` 重复上次运算；精度 `Number(v.toPrecision(12))` 消 0.30000000000000004 类噪声
   - 键盘映射 `keyToAction(key)`（数字/`.`/`+ - * /`/Enter/Backspace/Escape/c）同为纯函数
2. **`src/components/evaluate/calculator-popover.tsx`**：常驻挂载（trigger 按钮 + popover 显隐），状态存组件内（开合不丢历史；切供应商面板重挂载即重置）。点外关闭（document pointerdown + ref）；展开即聚焦容器吃键盘；Escape 只关计算器不退全屏。
3. **集成**：`requirement-compare-panel.tsx` 右栏 header 一行——标题右侧 `<CalculatorPopover className="ml-auto" />`。

## 留给实现者

- 按钮网格排布与 cgzxui 类的最终选择（依 water-erp:cgzxui 技能规范）
- 历史/表达式行与显示区的具体字号层级（对齐右栏现有 10px/11px 体系）
