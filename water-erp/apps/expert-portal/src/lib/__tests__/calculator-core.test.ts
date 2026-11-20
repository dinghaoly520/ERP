import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialCalcState,
  calcReducer,
  keyToAction,
  formatCalcDisplay,
  calcExprLine,
  type CalcAction,
  type CalcOp,
} from '../calculator-core.ts';

/** 序列驱动：从初始态依次 dispatch */
const run = (...actions: CalcAction[]) => actions.reduce(calcReducer, initialCalcState);
const d = (n: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'): CalcAction => ({ type: 'digit', d: n });
const op = (o: CalcOp): CalcAction => ({ type: 'op', op: o });
const eq = (): CalcAction => ({ type: 'equals' });
const dot = (): CalcAction => ({ type: 'dot' });
const pct = (): CalcAction => ({ type: 'percent' });
const neg = (): CalcAction => ({ type: 'negate' });
const bs = (): CalcAction => ({ type: 'backspace' });
const clr = (): CalcAction => ({ type: 'clear' });

test('digit 输入与 leading 零：0 仍为 0，0 后 5 → 5', () => {
  assert.equal(run(d('0')).display, '0');
  assert.equal(run(d('0'), d('5')).display, '5');
  assert.equal(run(d('0'), d('0'), d('0')).display, '0');
  assert.equal(run(d('1'), d('2')).display, '12');
});

test('dot：5 → "5."；初始 dot → "0."；第二个 dot 忽略', () => {
  assert.equal(run(d('5'), dot()).display, '5.');
  assert.equal(run(dot()).display, '0.');
  assert.equal(run(d('5'), dot(), dot()).display, '5.');
});

test('op 链式即时执行：2+3 后按 × → display=5、pendingOp=×', () => {
  const s = run(d('2'), op('+'), d('3'), op('×'));
  assert.equal(s.display, '5');
  assert.equal(s.pendingOp, '×');
  assert.equal(s.acc, 5);
});

test('equals：2+3= → 5，history[0]={expr:"2 + 3", result:"5"}', () => {
  const s = run(d('2'), op('+'), d('3'), eq());
  assert.equal(s.display, '5');
  assert.deepEqual(s.history[0], { expr: '2 + 3', result: '5' });
});

test('连按 = 重复上次运算：5+3= → 8，再 = → 11', () => {
  const s = run(d('5'), op('+'), d('3'), eq(), eq());
  assert.equal(s.display, '11');
  assert.equal(s.history.length, 2);
  assert.deepEqual(s.history[0], { expr: '8 + 3', result: '11' });
});

test('percent·v2.2 后缀语义：5% 不立即换算；1500 × 5% = → 75、expr 带百分号', () => {
  const mid = run(d('5'), pct());
  assert.equal(mid.display, '5');
  assert.equal(mid.entryPercent, true); // 显示层缀 %，数值不动
  const fin = run(d('1'), d('5'), d('0'), d('0'), op('×'), d('5'), pct(), eq());
  assert.equal(fin.display, '75');
  assert.equal(fin.history[0].expr, '1500 × 5%');
});

test('除零：5÷0= → error="除数不能为 0"；随后 digit 7 自愈 display=7、error=null', () => {
  const err = run(d('5'), op('÷'), d('0'), eq());
  assert.equal(err.error, '除数不能为 0');
  const healed = calcReducer(err, d('7'));
  assert.equal(healed.display, '7');
  assert.equal(healed.error, null);
  assert.equal(healed.acc, null);
  assert.equal(healed.pendingOp, null);
});

test('negate：5 → -5 → 5；freshEntry 态对结果取负仍 freshEntry（下个 digit 替换）', () => {
  assert.equal(run(d('5'), neg()).display, '-5');
  assert.equal(run(d('5'), neg(), neg()).display, '5');
  const s = run(d('2'), op('+'), d('3'), eq(), neg());
  assert.equal(s.display, '-5');
  assert.equal(calcReducer(s, d('7')).display, '7');
});

test('backspace："123" 逐位退到 "0"；freshEntry 态 no-op', () => {
  assert.equal(run(d('1'), d('2'), d('3'), bs(), bs()).display, '1');
  assert.equal(run(d('1'), bs()).display, '0');
  const s = run(d('2'), op('+'), d('3'), eq(), bs());
  assert.equal(s.display, '5');
});

test('clear：运算态全重置，history 保留', () => {
  const s = run(d('2'), op('+'), d('3'), eq(), d('4'), op('+'), clr());
  assert.equal(s.display, '0');
  assert.equal(s.acc, null);
  assert.equal(s.pendingOp, null);
  assert.equal(s.error, null);
  assert.equal(s.freshEntry, true);
  assert.equal(s.history.length, 1);
});

test('精度：0.1+0.2= → "0.3"', () => {
  assert.equal(run(d('0'), dot(), d('1'), op('+'), d('0'), dot(), d('2'), eq()).display, '0.3');
});

test('输入上限：第 16 位数字被忽略（display ≤15 字符）', () => {
  const acts: CalcAction[] = Array.from({ length: 16 }, () => d('1'));
  const s = run(...acts);
  assert.equal(s.display.length, 15);
  assert.equal(s.display, '111111111111111');
});

test('useHistory："5" 回填 display=5、freshEntry=true', () => {
  const base = run(d('2'), op('+'), d('3'), eq());
  const s = calcReducer(base, { type: 'useHistory', value: '5' });
  assert.equal(s.display, '5');
  assert.equal(s.freshEntry, true);
});

test('keyToAction：数字/./四则/Enter/=/Backspace/c/C/% 全映射，Escape 与无关键返回 null', () => {
  assert.deepEqual(keyToAction('5'), { type: 'digit', d: '5' });
  assert.deepEqual(keyToAction('0'), { type: 'digit', d: '0' });
  assert.deepEqual(keyToAction('.'), { type: 'dot' });
  assert.deepEqual(keyToAction('+'), { type: 'op', op: '+' });
  assert.deepEqual(keyToAction('-'), { type: 'op', op: '-' });
  assert.deepEqual(keyToAction('*'), { type: 'op', op: '×' });
  assert.deepEqual(keyToAction('x'), { type: 'op', op: '×' });
  assert.deepEqual(keyToAction('X'), { type: 'op', op: '×' });
  assert.deepEqual(keyToAction('/'), { type: 'op', op: '÷' });
  assert.deepEqual(keyToAction('Enter'), { type: 'equals' });
  assert.deepEqual(keyToAction('='), { type: 'equals' });
  assert.deepEqual(keyToAction('Backspace'), { type: 'backspace' });
  assert.deepEqual(keyToAction('c'), { type: 'clear' });
  assert.deepEqual(keyToAction('C'), { type: 'clear' });
  assert.deepEqual(keyToAction('%'), { type: 'percent' });
  assert.equal(keyToAction('Escape'), null);
  assert.equal(keyToAction('a'), null);
  assert.equal(keyToAction(' '), null);
});

test('calcExprLine：待算式行 acc 经 norm 消浮点噪声（终审 F1）', () => {
  // 0.1+0.2 后链式按 × → acc 原始双精度 0.30000000000000004，显示必须走 norm
  const s = run(d('0'), dot(), d('1'), op('+'), d('0'), dot(), d('2'), op('×'));
  assert.equal(s.acc, 0.30000000000000004); // 前置：确认 acc 确为噪声值
  assert.equal(calcExprLine(s), '0.3 ×');
  // 基本形态 + 空态
  assert.equal(calcExprLine(run(d('2'), op('+'))), '2 +');
  assert.equal(calcExprLine(run(d('2'), op('+'), d('3'), eq())), '');
  assert.equal(calcExprLine(run(d('1'), d('2'), d('3'), d('4'), d('5'), d('6'), d('7'), op('×'))), '1,234,567 ×');
});

test('formatCalcDisplay：千分位与负号原样', () => {
  assert.equal(formatCalcDisplay('1234567.89'), '1,234,567.89');
  assert.equal(formatCalcDisplay('-0.5'), '-0.5');
  assert.equal(formatCalcDisplay('5.'), '5.');
  assert.equal(formatCalcDisplay('0'), '0');
});

test('终审 F2：15 位整数后 dot 被忽略——不产生「有小数点却输不进小数」的锁死态', () => {
  const fifteen = Array.from({ length: 15 }, () => d('9')) as CalcAction[];
  const s = run(...fifteen, dot());
  assert.equal(s.display, '999999999999999'); // dot 未生效（数字预算已满）
  assert.equal(calcReducer(s, d('5')).display, '999999999999999'); // digit 上限依旧
  assert.equal(run(d('5'), dot()).display, '5.'); // 正常入口 dot 不受影响
});

test('终审 F7："-0." 退格归一为 "0"，后续数字正常（不留 "-012" 显示）', () => {
  const s = run(dot(), neg(), bs()); // '0.' → '-0.' → 退格 → 应归一 '0' 而非停驻 '-0'
  assert.equal(s.display, '0');
  assert.equal(calcReducer(s, d('1')).display, '1');
});

// ── v2 科学函数（2026-11-20）──
const sin = () => ({ type: 'unary', fn: 'sin' } as CalcAction);
const sqrtA = () => ({ type: 'unary', fn: 'sqrt' } as CalcAction);
const sqr = () => ({ type: 'unary', fn: 'sqr' } as CalcAction);
const inv = () => ({ type: 'unary', fn: 'inv' } as CalcAction);
const ln = () => ({ type: 'unary', fn: 'ln' } as CalcAction);
const pi = () => ({ type: 'constant', kind: 'pi' } as CalcAction);

test('科学·DEG 一元函数：30 sin → 0.5（精度归一）', () => {
  const s = run(d('3'), d('0'), sin());
  assert.equal(s.display, '0.5');
  assert.equal(s.freshEntry, true); // 函数结果后新数字重新起数
});

test('科学·角度模式切换：DEG 30 sin=0.5，toggleAngle 后 30 sin=RAD 值', () => {
  const rad = run({ type: 'toggleAngle' } as CalcAction, d('3'), d('0'), sin());
  assert.equal(rad.angleMode, 'RAD');
  assert.equal(rad.display, '-0.988031624093');
});

test('科学·域错误：√(-1) 与 ln(0) → 输入超出定义域；digit 自愈', () => {
  const negated = run(d('1'), neg(), sqrtA());
  assert.equal(negated.error, '输入超出定义域');
  const healed = calcReducer(negated, d('7'));
  assert.equal(healed.display, '7');
  assert.equal(run(d('0'), ln()).error, '输入超出定义域');
});

test('科学·x²/1/x：5 x²→25；8 1/x→0.125；0 1/x→除零文案', () => {
  assert.equal(run(d('5'), sqr()).display, '25');
  assert.equal(run(d('8'), inv()).display, '0.125');
  assert.equal(run(d('0'), inv()).error, '除数不能为 0');
});

test('科学·常量 π/e：12 位有效数字进入显示', () => {
  assert.equal(run(pi()).display, '3.14159265359');
  assert.equal(run({ type: 'constant', kind: 'e' } as CalcAction).display, '2.71828182846');
});

test('科学·x^y：2 ^ 10 = → 1024；与 + 链式 2^3+1=9（即时执行）', () => {
  assert.equal(run(d('2'), op('^'), d('1'), d('0'), eq()).display, '1024');
  assert.equal(run(d('2'), op('^'), d('3'), op('+'), d('1'), eq()).display, '9');
});

test('科学·一元函数作用于 = 后结果：4 = √ → 2 且 freshEntry', () => {
  const s = run(d('4'), eq(), sqrtA());
  assert.equal(s.display, '2');
  assert.equal(s.freshEntry, true);
});

test('keyToAction：^ 映射为 op ^', () => {
  assert.deepEqual(keyToAction('^'), { type: 'op', op: '^' });
});

// ── v2.1 括号（AOS 栈：即时执行 + 括号上下文）──
const po = () => ({ type: 'paren', kind: 'open' } as CalcAction);
const pc = () => ({ type: 'paren', kind: 'close' } as CalcAction);

test('括号·基础：2 × (3+4) = → 14，纸带 expr 含括号原文', () => {
  const s = run(d('2'), op('×'), po(), d('3'), op('+'), d('4'), pc(), eq());
  assert.equal(s.display, '14');
  assert.equal(s.history[0].expr, '2 × (3 + 4)');
  assert.equal(s.history[0].result, '14');
  assert.equal(s.parenStack.length, 0);
});

test('括号·隐式乘法：5 ( 3+2 ) = → 25，expr=5 × (3 + 2)', () => {
  const s = run(d('5'), po(), d('3'), op('+'), d('2'), pc(), eq());
  assert.equal(s.display, '25');
  assert.equal(s.history[0].expr, '5 × (3 + 2)');
});

test('括号·嵌套：2 × (3 + (4−1)) = → 12，expr 双层括号', () => {
  const s = run(d('2'), op('×'), po(), d('3'), op('+'), po(), d('4'), op('-'), d('1'), pc(), pc(), eq());
  assert.equal(s.display, '12');
  assert.equal(s.history[0].expr, '2 × (3 + (4 − 1))');
});

test('括号·无运算内层与空栈 close：( 7 ) = → 7；栈空 close 为 no-op', () => {
  assert.equal(run(po(), d('7'), pc(), eq()).display, '7');
  assert.equal(run(po(), d('7'), pc(), eq()).history[0].expr, '7');
  const s = run(d('5'), pc());
  assert.equal(s.display, '5');
  assert.equal(s.parenStack.length, 0);
});

test('括号·= 自动闭合未关括号并清栈', () => {
  const s = run(d('2'), op('×'), po(), d('3'), op('+'), d('4'), eq());
  assert.equal(s.display, '14');
  assert.equal(s.parenStack.length, 0);
});

test('括号·深度上限 8：第 9 个 ( 被忽略', () => {
  const acts: CalcAction[] = [];
  for (let i = 0; i < 9; i++) acts.push(po());
  const s = run(...acts);
  assert.equal(s.parenStack.length, 8);
  assert.equal(s.display, '0');
});

test('括号·) 后数字替换内层结果（外层 pendingOp 保留）', () => {
  const s = run(d('2'), op('×'), po(), d('3'), op('+'), d('4'), pc(), d('5'));
  assert.equal(s.display, '5');
  assert.equal(s.acc, 2);
  assert.equal(s.pendingOp, '×');
});

test('括号·clear 清栈且保留角度模式（v2.1 修复 clear 误重置 angleMode）', () => {
  const s = run({ type: 'toggleAngle' } as CalcAction, po(), clr());
  assert.equal(s.parenStack.length, 0);
  assert.equal(s.angleMode, 'RAD');
});

test('括号·含括号计算后连按 = 不重复（lastOp 清空）', () => {
  const s = run(d('2'), op('×'), po(), d('3'), op('+'), d('4'), eq(), eq());
  assert.equal(s.display, '14');
  assert.equal(s.history.length, 1);
});

test('keyToAction：( ) 映射 paren open/close', () => {
  assert.deepEqual(keyToAction('('), { type: 'paren', kind: 'open' });
  assert.deepEqual(keyToAction(')'), { type: 'paren', kind: 'close' });
});

// ── v2.2 百分号后缀语义（用户裁定：按下不立即换算，求值时 ÷100）──
test('百分号·幂等与结果态：已缀再按 no-op；freshEntry 态 no-op', () => {
  assert.equal(run(d('5'), pct(), pct()).entryPercent, true);
  assert.equal(run(d('2'), op('+'), d('3'), eq(), pct()).entryPercent, false);
});

test('百分号·backspace 先摘后缀再删数字；缀后输数字开新条目', () => {
  const s = run(d('5'), d('2'), pct(), bs());
  assert.equal(s.display, '52');
  assert.equal(s.entryPercent, false);
  assert.equal(calcReducer(s, bs()).display, '5');
  const t = run(d('5'), pct(), d('7'));
  assert.equal(t.display, '7');
  assert.equal(t.entryPercent, false);
});

test('百分号·negate 保留后缀：5% ± → -5%，求值 -0.05', () => {
  const s = run(d('5'), pct(), neg());
  assert.equal(s.display, '-5');
  assert.equal(s.entryPercent, true);
  // 求值路径：( 5% ± ) 纯段 = → -0.05
  assert.equal(run(po(), d('5'), pct(), neg(), pc(), eq()).display, '-0.05');
});

test('百分号·一元函数消费百分值：50% √ → √0.5', () => {
  assert.equal(run(d('5'), d('0'), pct(), sqrtA()).display, '0.707106781187');
});

test('百分号·括号内：1500 × (5%) = → 75，expr=1500 × (5%)', () => {
  const s = run(d('1'), d('5'), d('0'), d('0'), op('×'), po(), d('5'), pct(), pc(), eq());
  assert.equal(s.display, '75');
  assert.equal(s.history[0].expr, '1500 × (5%)');
});

test('百分号·运算符链消费：1500 × 5% × 2 = → 150', () => {
  const s = run(d('1'), d('5'), d('0'), d('0'), op('×'), d('5'), pct(), op('×'), d('2'), eq());
  assert.equal(s.display, '150');
});

test('百分号·dot 尾缀归一：5. % → display=5 后缀生效', () => {
  const s = run(d('5'), dot(), pct());
  assert.equal(s.display, '5');
  assert.equal(s.entryPercent, true);
});
