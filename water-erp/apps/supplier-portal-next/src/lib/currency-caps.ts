/* =====================================================================
   人民币金额大写（注册资金输入实时显示，2026-10-09）
   --------------------------------------------------------------------
   财务口径：整数四位分级（万/亿/万亿），零的压缩与组间补零，角分精确到分。
   纯函数、零依赖，便于 node:test 单测复用。
   ===================================================================== */

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
/** 四位一组的组内单位（个/拾/佰/仟） */
const SMALL_UNITS = ['', '拾', '佰', '仟'];
/** 组间大单位：个级、万级、亿级、万亿级 */
const BIG_UNITS = ['', '万', '亿', '万亿'];

/** 组内（≤4 位）转大写：'0500'→'伍佰'、'1001'→'壹仟零壹'、末尾零自然脱落 */
function fourDigitsToCaps(g: string): string {
  let s = '';
  let pendingZero = false;
  const len = g.length;
  for (let i = 0; i < len; i++) {
    const d = Number(g[i]);
    if (d === 0) {
      if (s !== '') pendingZero = true;
      continue;
    }
    if (pendingZero) {
      s += '零';
      pendingZero = false;
    }
    s += DIGITS[d] + SMALL_UNITS[len - 1 - i];
  }
  return s;
}

/** 整数部分转大写数字（不含「元」）：'10001'→'壹万零壹'、'100000000'→'壹亿' */
export function integerToCaps(n: string): string {
  if (!/^\d+$/.test(n)) return '';
  const trimmed = n.replace(/^0+(?=\d)/, '');
  if (trimmed === '0') return '零';
  const groups: string[] = [];
  for (let i = trimmed.length; i > 0; i -= 4) {
    groups.unshift(trimmed.slice(Math.max(0, i - 4), i));
  }
  let out = '';
  groups.forEach((g, idx) => {
    const big = BIG_UNITS[groups.length - 1 - idx] ?? '';
    const num = Number(g);
    if (num === 0) return; // 全零组跳过，不落大单位（零由相邻低组的 <1000 判断补）
    let part = fourDigitsToCaps(g);
    if (out !== '' && num < 1000) part = `零${part}`; // 千位为 0 → 组间必补零
    out += part + big;
  });
  return out;
}

/** 十进制小数点右移（字符串精确运算，避开浮点误差）：shiftDecimal('5000.5', 4) → '50005000' */
export function shiftDecimal(v: string, places: number): string {
  if (!/^\d+(\.\d+)?$/.test(v)) return '';
  const neg = false; // 注册资金无负数
  const [int, dec = ''] = v.split('.');
  const digits = int + dec;
  const fracLen = dec.length;
  const newFracLen = Math.max(fracLen - places, 0);
  const padded = digits.padEnd(digits.length - fracLen + places + newFracLen, '0');
  const newInt = (padded.slice(0, padded.length - newFracLen) || '0').replace(/^0+(?=\d)/, '');
  const result = newFracLen === 0 ? newInt : `${newInt}.${padded.slice(-newFracLen)}`;
  return neg ? `-${result}` : result;
}

/**
 * 金额 → 人民币大写（含「人民币」前缀与「元/角/分/整」）。
 * 输入纯数字字符串或 number；非法输入返回空串（调用方自行兜底显示）。
 * formatCNYCaps('12345678.09') → '人民币壹仟贰佰叁拾肆万伍仟陆佰柒拾捌元零玖分'
 */
export function formatCNYCaps(input: string | number): string {
  const raw = typeof input === 'number' ? String(input) : input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return '';
  const [int, dec = ''] = raw.split('.');
  const intCaps = integerToCaps(int);
  const jiao = dec.length >= 1 ? Number(dec[0]) : 0;
  const fen = dec.length >= 2 ? Number(dec[1]) : 0;
  let s = `人民币${intCaps}元`;
  if (jiao === 0 && fen === 0) return `${s}整`;
  if (jiao > 0) {
    s += `${DIGITS[jiao]}角`;
  } else if (fen > 0) {
    s += '零';
  }
  if (fen > 0) s += `${DIGITS[fen]}分`;
  return s;
}
