import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialCalcState,
  calcReducer,
  keyToAction,
  formatCalcDisplay,
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

test('percent：1500 × 5 % → display=0.05，再 = → 75', () => {
  const mid = run(d('1'), d('5'), d('0'), d('0'), op('×'), d('5'), pct());
  assert.equal(mid.display, '0.05');
  const fin = calcReducer(mid, eq());
  assert.equal(fin.display, '75');
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

test('formatCalcDisplay：千分位与负号原样', () => {
  assert.equal(formatCalcDisplay('1234567.89'), '1,234,567.89');
  assert.equal(formatCalcDisplay('-0.5'), '-0.5');
  assert.equal(formatCalcDisplay('5.'), '5.');
  assert.equal(formatCalcDisplay('0'), '0');
});
