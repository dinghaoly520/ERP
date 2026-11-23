/**
 * 通用计算器核心 v3（2026-11-20）——评标工作台「表达式计算器」求值引擎。
 * 用户裁定（推翻 v1~v2.2 即时执行状态机）：算式完整可编辑、点击 = 才求值、键盘原生输入。
 * 文法参照成熟开源实现 expr-eval 的优先级/结合性表（^ 右结合幂、一元负号弱于幂），
 * 语义按采购场景定制：% 为操作数后缀（=÷100，非 modulo）、log=以 10 为底、隐式乘法
 * （2(3+4)、2π、2sin(30)）、中文错误消息、DEG/RAD 角度模式。
 * 纯函数、无 React/DOM；tokenizer + 递归下降解析。
 *
 * 边界语义留档（终审#10，均为 expr-eval 式可辩护取舍）：
 * - `e` 恒为欧拉常量（无科学计数）：`2e`=2×e≈5.4365；`1e5` 报「算式不完整」
 * - `5%(2)` = (5%)×2 = 0.1（% 后缀先归值再隐式乘）
 * - `tan(90)` DEG 返回浮点伪值 1.633e16（与标准数学库一致，未特判）
 * - 深嵌套（~1500+ 层）→「算式过于复杂」（递归栈防护）
 */

export type AngleMode = 'DEG' | 'RAD';

export interface CalcHistoryEntry {
  expr: string;
  result: string;
}

export type EvalResult = { ok: true; value: number; text: string } | { ok: false; error: string };

/** 浮点噪声归一：12 位有效数字后回字符串（0.1+0.2 → "0.3"） */
export const normCalc = (n: number): string => String(Number(n.toPrecision(12)));

const DIV_ZERO_MSG = '除数不能为 0';
const DOMAIN_MSG = '输入超出定义域';
const INCOMPLETE_MSG = '算式不完整';
const UNCLOSED_MSG = '括号未闭合';
const MISMATCH_MSG = '括号不匹配';
const OVERFLOW_MSG = '结果超出范围';

// ── Tokenizer ──

type Tok =
  | { t: 'num'; v: number }
  | { t: 'op'; v: '+' | '−' | '×' | '÷' | '^' }
  | { t: 'pct' }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'const'; v: 'π' | 'e' }
  | { t: 'fn'; v: 'sin' | 'cos' | 'tan' | 'ln' | 'log' | '√' };

const FN_NAMES = ['sin', 'cos', 'tan', 'ln', 'log', '√'] as const;

/** ASCII 键盘输入归一为显示形（* → ×、/ → ÷、- → −；1:1 替换不动光标） */
export const normalizeExprChars = (s: string): string =>
  s.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');

function tokenize(src: string): Tok[] {
  const s = normalizeExprChars(src);
  const toks: Tok[] = [];
  let i = 0;
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m || m[0] === '.') throw new Error(INCOMPLETE_MSG); // 裸 '.' 不是数
      // 相邻两个数字（如 2..5 / "2 3"）不隐式相乘——上一个 token 是数字则报错
      const prev = toks[toks.length - 1];
      if (prev && prev.t === 'num') throw new Error(INCOMPLETE_MSG);
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z]+/.exec(s.slice(i)) as RegExpExecArray;
      const name = m[0];
      const lower = name.toLowerCase();
      if (lower === 'e') {
        toks.push({ t: 'const', v: 'e' });
      } else if ((FN_NAMES as readonly string[]).includes(lower)) {
        toks.push({ t: 'fn', v: lower as (typeof FN_NAMES)[number] });
      } else {
        fail(`无法识别的符号「${name}」`);
      }
      i += name.length;
      continue;
    }
    if (c === 'π') {
      toks.push({ t: 'const', v: 'π' });
      i++;
      continue;
    }
    if (c === '√') {
      toks.push({ t: 'fn', v: '√' });
      i++;
      continue;
    }
    if (c === '+') toks.push({ t: 'op', v: '+' });
    else if (c === '−') toks.push({ t: 'op', v: '−' });
    else if (c === '×') toks.push({ t: 'op', v: '×' });
    else if (c === '÷') toks.push({ t: 'op', v: '÷' });
    else if (c === '^') toks.push({ t: 'op', v: '^' });
    else if (c === '%') toks.push({ t: 'pct' });
    else if (c === '(') toks.push({ t: 'lp' });
    else if (c === ')') toks.push({ t: 'rp' });
    else fail(`无法识别的符号「${c}」`);
    i++;
  }
  return toks;
}

// ── 递归下降解析（优先级：() > %后缀 > ^右结合 > 一元− > ×÷/隐式乘 > +−）──

class Parser {
  private pos = 0;
  private toks: Tok[];
  private mode: AngleMode;
  constructor(toks: Tok[], mode: AngleMode) {
    this.toks = toks;
    this.mode = mode;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  parse(): number {
    const v = this.parseAdd();
    const rest = this.peek();
    if (rest) {
      if (rest.t === 'rp') throw new Error(MISMATCH_MSG);
      throw new Error(INCOMPLETE_MSG);
    }
    return v;
  }

  private parseAdd(): number {
    let v = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '−')) {
        this.pos++;
        const rhs = this.parseMul();
        v = t.v === '+' ? v + rhs : v - rhs;
      } else break;
    }
    return v;
  }

  private parseMul(): number {
    let v = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '×' || t.v === '÷')) {
        this.pos++;
        const rhs = this.parseUnary();
        if (t.v === '÷' && rhs === 0) throw new Error(DIV_ZERO_MSG);
        v = t.v === '×' ? v * rhs : v / rhs;
      } else if (t && (t.t === 'lp' || t.t === 'fn' || t.t === 'const')) {
        // 隐式乘法：2(3+4) / 2π / (2)(3) / 2sin(30)
        v = v * this.parseUnary();
      } else break;
    }
    return v;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '−') {
      this.pos++;
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '^') {
      this.pos++;
      const exp = this.parseUnary(); // 右结合；右元允许一元负号（2^-2）
      return Math.pow(base, exp);
    }
    return base;
  }

  private parsePostfix(): number {
    let v = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'pct') {
        this.pos++;
        v = v / 100;
      } else break;
    }
    return v;
  }

  private parsePrimary(): number {
    const t = this.peek();
    if (!t) throw new Error(INCOMPLETE_MSG);
    if (t.t === 'num') {
      this.pos++;
      return t.v;
    }
    if (t.t === 'const') {
      this.pos++;
      return t.v === 'π' ? Math.PI : Math.E;
    }
    if (t.t === 'fn') {
      this.pos++;
      // 函数必须带括号：sin( … )
      const nx = this.peek();
      if (!nx || nx.t !== 'lp') throw new Error(INCOMPLETE_MSG);
      this.pos++;
      const v = this.parseAdd();
      const closing = this.peek();
      if (!closing || closing.t !== 'rp') throw new Error(UNCLOSED_MSG);
      this.pos++;
      return applyFn(t.v, v, this.mode);
    }
    if (t.t === 'lp') {
      this.pos++;
      return this.parseParenBody();
    }
    throw new Error(INCOMPLETE_MSG);
  }

  /** 已消费 '(' 后的括号体：expr + 必须的 ')' */
  private parseParenBody(): number {
    const v = this.parseAdd();
    const t = this.peek();
    if (!t || t.t !== 'rp') throw new Error(UNCLOSED_MSG);
    this.pos++;
    return v;
  }
}

function applyFn(fn: 'sin' | 'cos' | 'tan' | 'ln' | 'log' | '√', v: number, mode: AngleMode): number {
  switch (fn) {
    case 'sin':
    case 'cos':
    case 'tan': {
      const r = mode === 'DEG' ? (v * Math.PI) / 180 : v;
      return fn === 'sin' ? Math.sin(r) : fn === 'cos' ? Math.cos(r) : Math.tan(r);
    }
    case 'ln':
      if (v <= 0) throw new Error(DOMAIN_MSG);
      return Math.log(v);
    case 'log':
      if (v <= 0) throw new Error(DOMAIN_MSG);
      return Math.log10(v);
    case '√':
      if (v < 0) throw new Error(DOMAIN_MSG);
      return Math.sqrt(v);
  }
}

/** 求值入口：空算式/解析错误/域错误 → {ok:false,error}；成功 → {ok:true,value,text=normCalc} */
export function evaluateCalc(expr: string, angleMode: AngleMode = 'DEG'): EvalResult {
  if (!expr || !expr.trim()) return { ok: false, error: '请输入算式' };
  try {
    const value = new Parser(tokenize(expr), angleMode).parse();
    if (!Number.isFinite(value)) return { ok: false, error: OVERFLOW_MSG };
    return { ok: true, value, text: normCalc(value) };
  } catch (e) {
    // 终审#3：深嵌套（~1500+ 层括号）触发解析器递归栈溢出——归一为中文消息
    if (e instanceof RangeError) return { ok: false, error: '算式过于复杂' };
    return { ok: false, error: e instanceof Error ? e.message : INCOMPLETE_MSG };
  }
}
