import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalc, normCalc, type AngleMode } from '../calculator-core.ts';

const ok = (expr: string, mode: AngleMode = 'DEG') => {
  const r = evaluateCalc(expr, mode);
  assert.ok(r.ok, `expected ok: ${JSON.stringify(r)}`);
  return r as Extract<ReturnType<typeof evaluateCalc>, { ok: true }>;
};
const err = (expr: string, mode: AngleMode = 'DEG') => {
  const r = evaluateCalc(expr, mode);
  assert.ok(!r.ok, `expected error: ${JSON.stringify(r)}`);
  return (r as Extract<ReturnType<typeof evaluateCalc>, { ok: false }>).error;
};

test('v3·四则与优先级：2+3×4=14；10÷4=2.5；(2+3)×4=20', () => {
  assert.equal(ok('2+3×4').text, '14');
  assert.equal(ok('10÷4').text, '2.5');
  assert.equal(ok('(2+3)×4').text, '20');
  assert.equal(ok('2×(3+(4−1))').text, '12');
});

test('v3·幂右结合与一元负号弱于幂：2^3^2=512；-2^2=-4；2^-2=0.25', () => {
  assert.equal(ok('2^3^2').text, '512');
  assert.equal(ok('-2^2').text, '-4');
  assert.equal(ok('2^-2').text, '0.25');
});

test('v3·隐式乘法：2(3+4)=14；2π；(2)(3)=6；2sin(30)=1', () => {
  assert.equal(ok('2(3+4)').text, '14');
  assert.equal(ok('2π').text, '6.28318530718');
  assert.equal(ok('(2)(3)').text, '6');
  assert.equal(ok('2sin(30)').text, '1');
});

test('v3·百分号后缀（=/100，缀于操作数）：1500×5%=75；50%×200=100；5%%=0.0005；2+5%=2.05', () => {
  assert.equal(ok('1500×5%').text, '75');
  assert.equal(ok('50%×200').text, '100');
  assert.equal(ok('5%%').text, '0.0005');
  assert.equal(ok('2+5%').text, '2.05');
});

test('v3·常量：π 与 e（12 位有效数字）', () => {
  assert.equal(ok('π').text, '3.14159265359');
  assert.equal(ok('e').text, '2.71828182846');
});

test('v3·三角 DEG：sin(30)=0.5；cos(60)=0.5；tan(45)=1', () => {
  assert.equal(ok('sin(30)').text, '0.5');
  assert.equal(ok('cos(60)').text, '0.5');
  assert.equal(ok('tan(45)').text, '1');
});

test('v3·RAD 模式：sin(π÷2)=1', () => {
  assert.equal(ok('sin(π÷2)', 'RAD').text, '1');
});

test('v3·对数与根：√(2)；ln(e)=1；log(100)=2（log=以10为底）', () => {
  assert.equal(ok('√(2)').text, '1.41421356237');
  assert.equal(ok('ln(e)').text, '1');
  assert.equal(ok('log(100)').text, '2');
});

test('v3·ASCII 键盘混排与空格：2*3/4=1.5；2 + 3=5（* / - 归一为 × ÷ −）', () => {
  assert.equal(ok('2*3/4').text, '1.5');
  assert.equal(ok('2 + 3').text, '5');
  assert.equal(ok('10-2').text, '8');
});

test('v3·浮点精度：0.1+0.2=0.3（toPrecision(12) 归一）', () => {
  assert.equal(ok('0.1+0.2').text, '0.3');
});

test('v3·错误族：空/不完整/括号/除零/定义域/未知符号/相邻数字', () => {
  assert.deepEqual(evaluateCalc(''), { ok: false, error: '请输入算式' });
  assert.deepEqual(evaluateCalc('   '), { ok: false, error: '请输入算式' });
  assert.equal(err('2+'), '算式不完整');
  assert.equal(err('2×'), '算式不完整');
  assert.equal(err('(2+3'), '括号未闭合');
  assert.equal(err('2+3)'), '括号不匹配');
  assert.equal(err('5÷0'), '除数不能为 0');
  assert.equal(err('5÷(3−3)'), '除数不能为 0');
  assert.equal(err('ln(0)'), '输入超出定义域');
  assert.equal(err('log(−5)'), '输入超出定义域');
  assert.equal(err('√(-1)'), '输入超出定义域');
  assert.equal(err('abc'), '无法识别的符号「abc」');
  assert.equal(err('2..5'), '算式不完整'); // 相邻数字不隐式相乘
  assert.equal(err('2 3'), '算式不完整');
  assert.equal(err('99999999999^99'), '结果超出范围');
});

test('v3·ok 形状：{ok:true,value,text}', () => {
  const r = ok('2+3');
  assert.deepEqual(r, { ok: true, value: 5, text: '5' });
});

test('normCalc：12 位有效数字归一导出', () => {
  assert.equal(normCalc(0.1 + 0.2), '0.3');
  assert.equal(normCalc(1 / 3), '0.333333333333');
});

test('终审#3·深嵌套防护：1600 层括号 → 中文「算式过于复杂」（不透出英文栈溢出）', () => {
  const deep = '('.repeat(1600) + '2' + ')'.repeat(1600);
  assert.equal(err(deep), '算式过于复杂');
});
