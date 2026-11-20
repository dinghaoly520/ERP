/**
 * 通用计算器核心（2026-11-20 v1，同日 v2 增科学函数）——评标工作台计算器纯函数状态机。
 * 无 React/DOM 依赖；语义裁定见 docs/superpowers/specs/2026-11-20-expert-compare-calculator-design.md：
 * % = 当前值÷100；连按 = 重复上次运算；C 重置运算态但保留 history；
 * 错误态仅 digit/clear 有效（digit 自愈重新起数）；精度 toPrecision(12) 消浮点噪声。
 * v2：一元函数（sin/cos/tan/ln/log/√/x²/1/x）按下即作用于当前显示值（不进 history，仅 = 记账）；
 * xʸ 为即时执行链上的二元运算（无优先级，与 +−×÷ 同链）；π/e 为常量输入；
 * 角度模式 angleMode（DEG 默认，可切 RAD）仅影响三角函数。
 */

export type CalcOp = '+' | '-' | '×' | '÷' | '^';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type CalcDigit = (typeof DIGITS)[number];

export interface CalcHistoryEntry {
  expr: string;
  result: string;
}

/** v2.1 括号帧：'(' 压栈保存的外层上下文（accStr 供纸带重建带括号原文的算式） */
export interface CalcParenFrame {
  accVal: number | null;
  accStr: string | null;
  op: CalcOp | null;
}

export interface CalcState {
  /** 当前输入/结果的原始数字串（无千分位） */
  display: string;
  /** 左操作数累积（即时执行链） */
  acc: number | null;
  /** 待应用运算符 */
  pendingOp: CalcOp | null;
  /** 上次 = 的右操作数（重复 = 复用） */
  lastOperand: number | null;
  /** 上次 = 的运算符（重复 = 复用） */
  lastOp: CalcOp | null;
  /** true = 下个 digit 重新起数（运算符/= 之后） */
  freshEntry: boolean;
  /** '除数不能为 0'（错误态仅 digit/clear 自愈） */
  error: string | null;
  /** 最近计算记录，新的在前，≤12 条（v2 纸带加高提容） */
  history: CalcHistoryEntry[];
  /** 角度模式（仅三角函数）：DEG 默认，RAD 可切（v2） */
  angleMode: 'DEG' | 'RAD';
  /** v2.1 括号栈（未闭合的 '(' 上下文，内层在栈顶方向为尾元素）；深度上限 8 */
  parenStack: CalcParenFrame[];
  /** v2.1 当前显示值的来源算式（')' 折叠产生，如 '3 + 4'）——纸带按括号原文记账；被直接编辑即清空 */
  segExpr: string | null;
}

export type CalcAction =
  | { type: 'digit'; d: CalcDigit }
  | { type: 'dot' }
  | { type: 'op'; op: CalcOp }
  | { type: 'equals' }
  | { type: 'percent' }
  | { type: 'negate' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'useHistory'; value: string }
  /** v2 一元函数：按下即作用于当前显示值 */
  | { type: 'unary'; fn: 'sin' | 'cos' | 'tan' | 'ln' | 'log' | 'sqrt' | 'sqr' | 'inv' }
  /** v2 常量输入（π/e） */
  | { type: 'constant'; kind: 'pi' | 'e' }
  /** v2 角度模式切换 DEG⇄RAD */
  | { type: 'toggleAngle' }
  /** v2.1 括号：open 压栈（裸数字后=隐式乘法）；close 先算内层再弹栈 */
  | { type: 'paren'; kind: 'open' | 'close' };

export const initialCalcState: CalcState = {
  display: '0',
  acc: null,
  pendingOp: null,
  lastOperand: null,
  lastOp: null,
  freshEntry: true,
  error: null,
  history: [],
  angleMode: 'DEG',
  parenStack: [],
  segExpr: null,
};

const MAX_ENTRY_LEN = 15;
const MAX_PAREN_DEPTH = 8;
const DIV_ZERO_MSG = '除数不能为 0';
const DOMAIN_MSG = '输入超出定义域';

/** 浮点噪声归一：12 位有效数字后回字符串（0.1+0.2 → "0.3"） */
const norm = (n: number): string => String(Number(n.toPrecision(12)));

/** 算式文本里的减号渲染为排版用 −（与键面一致；仅展示层，运算仍是 '-'） */
const opSym = (o: CalcOp): string => (o === '-' ? '−' : o);

const apply = (a: number, o: CalcOp, b: number): number =>
  o === '+' ? a + b : o === '-' ? a - b : o === '×' ? a * b : o === '^' ? Math.pow(a, b) : a / b;

/** 错误态（运算链与括号栈全清、保留 history；digit/clear 自愈） */
const errored = (state: CalcState, message: string): CalcState => ({
  ...state,
  display: '0',
  acc: null,
  pendingOp: null,
  lastOperand: null,
  lastOp: null,
  freshEntry: true,
  error: message,
  parenStack: [],
  segExpr: null,
});

/** v2 一元函数实现；返回 null 表示域错误 */
const applyUnary = (v: number, fn: 'sin' | 'cos' | 'tan' | 'ln' | 'log' | 'sqrt' | 'sqr' | 'inv', angleMode: 'DEG' | 'RAD'): number | null => {
  switch (fn) {
    case 'sin':
    case 'cos':
    case 'tan': {
      const r = angleMode === 'DEG' ? (v * Math.PI) / 180 : v;
      return fn === 'sin' ? Math.sin(r) : fn === 'cos' ? Math.cos(r) : Math.tan(r);
    }
    case 'ln':
      return v > 0 ? Math.log(v) : null;
    case 'log':
      return v > 0 ? Math.log10(v) : null;
    case 'sqrt':
      return v >= 0 ? Math.sqrt(v) : null;
    case 'sqr':
      return v * v;
    case 'inv':
      return v === 0 ? null : 1 / v;
  }
};

/** v2：纸带显示区加高，历史容量 5 → 12（2026-11-20 用户需求「看见更多输入历史」） */
const HISTORY_CAP = 12;
const withHistory = (state: CalcState, entry: CalcHistoryEntry): CalcHistoryEntry[] =>
  [entry, ...state.history].slice(0, HISTORY_CAP);

export function calcReducer(state: CalcState, action: CalcAction): CalcState {
  switch (action.type) {
    case 'digit': {
      // 错误态自愈：digit 重新起数（保留 history）
      if (state.error) {
        return {
          ...state,
          display: action.d,
          acc: null,
          pendingOp: null,
          lastOperand: null,
          lastOp: null,
          freshEntry: false,
          error: null,
          segExpr: null,
        };
      }
      if (state.freshEntry) return { ...state, display: action.d, freshEntry: false, segExpr: null };
      if (state.display.length >= MAX_ENTRY_LEN) return state; // 输入上限
      if (state.display === '0') {
        return action.d === '0' ? state : { ...state, display: action.d };
      }
      return { ...state, display: state.display + action.d };
    }

    case 'dot': {
      if (state.error) return state;
      if (state.freshEntry) return { ...state, display: '0.', freshEntry: false, segExpr: null };
      if (state.display.includes('.')) return state;
      // 终审 F2：数字预算（15 位）已满时忽略 dot——否则产生「有小数点却输不进小数」的锁死态
      if (state.display.replace(/[^\d]/g, '').length >= MAX_ENTRY_LEN) return state;
      return { ...state, display: `${state.display}.` };
    }

    case 'op': {
      if (state.error) return state;
      // 即时执行：已有待算运算符且右操作数已输入 → 先算再挂新运算符
      if (state.pendingOp !== null && !state.freshEntry) {
        const acc = apply(state.acc as number, state.pendingOp, Number(state.display));
        return { ...state, acc, display: norm(acc), pendingOp: action.op, freshEntry: true, segExpr: null };
      }
      if (state.acc === null) {
        return { ...state, acc: Number(state.display), pendingOp: action.op, freshEntry: true, segExpr: null };
      }
      // freshEntry 下改选运算符（5 + 后改 × 不重算）
      return { ...state, pendingOp: action.op, freshEntry: true, segExpr: null };
    }

    case 'equals': {
      if (state.error) return state;
      if (state.pendingOp !== null) {
        const left = state.acc as number;
        const right = Number(state.display);
        if (state.pendingOp === '÷' && right === 0) return errored(state, DIV_ZERO_MSG);
        let val = apply(left, state.pendingOp, right);
        // 纸带算式：segExpr 存在（内层来自括号折叠）→ 按括号原文记账
        let str =
          state.segExpr !== null
            ? `${norm(left)} ${opSym(state.pendingOp)} (${state.segExpr})`
            : `${norm(left)} ${opSym(state.pendingOp)} ${norm(right)}`;
        // = 自动闭合未关括号（Windows/Casio 惯例），自内向外折叠
        let folded = false;
        const stack = [...state.parenStack];
        while (stack.length > 0) {
          const f = stack.pop() as CalcParenFrame;
          folded = true;
          if (f.op !== null && f.accVal !== null) {
            if (f.op === '÷' && val === 0) return errored(state, DIV_ZERO_MSG);
            str = `${f.accStr} ${opSym(f.op)} (${str})`;
            val = apply(f.accVal, f.op, val);
          } else {
            str = `(${str})`;
          }
        }
        const display = norm(val);
        const linear = state.segExpr === null && !folded; // 线性算式才保留「连按 = 重复」语义
        return {
          ...state,
          display,
          acc: null,
          pendingOp: null,
          lastOperand: linear ? right : null,
          lastOp: linear ? state.pendingOp : null,
          freshEntry: true,
          segExpr: null,
          parenStack: [],
          history: withHistory(state, { expr: str, result: display }),
        };
      }
      // 纯括号段（无 pendingOp 但有未关栈或 segExpr）：折叠后记账
      if (state.parenStack.length > 0 || state.segExpr !== null) {
        let val = Number(state.display);
        let str = state.segExpr ?? norm(val);
        const stack = [...state.parenStack];
        while (stack.length > 0) {
          const f = stack.pop() as CalcParenFrame;
          if (f.op !== null && f.accVal !== null) {
            if (f.op === '÷' && val === 0) return errored(state, DIV_ZERO_MSG);
            str = `${f.accStr} ${opSym(f.op)} (${str})`;
            val = apply(f.accVal, f.op, val);
          } else {
            str = `(${str})`;
          }
        }
        const display = norm(val);
        return {
          ...state,
          display,
          freshEntry: true,
          segExpr: null,
          parenStack: [],
          lastOperand: null,
          lastOp: null,
          history: withHistory(state, { expr: str, result: display }),
        };
      }
      // 连按 = 重复上次运算
      if (state.lastOp !== null && state.lastOperand !== null) {
        const left = Number(state.display);
        if (state.lastOp === '÷' && state.lastOperand === 0) {
          return errored(state, DIV_ZERO_MSG);
        }
        const display = norm(apply(left, state.lastOp, state.lastOperand));
        const expr = `${norm(left)} ${opSym(state.lastOp)} ${norm(state.lastOperand)}`;
        return {
          ...state,
          display,
          freshEntry: true,
          history: withHistory(state, { expr, result: display }),
        };
      }
      return state;
    }

    case 'paren': {
      if (state.error) return state;
      if (action.kind === 'open') {
        if (state.parenStack.length >= MAX_PAREN_DEPTH) return state; // 深度上限，静默忽略
        let frame: CalcParenFrame;
        if (state.acc !== null && state.pendingOp !== null) {
          // 挂起中的外层运算：2 × ( → 压栈 {2, ×}
          frame = { accVal: state.acc, accStr: norm(state.acc), op: state.pendingOp };
        } else if (state.acc === null && state.pendingOp === null && !state.freshEntry) {
          // 隐式乘法：5 ( → 5 × (
          frame = { accVal: Number(state.display), accStr: norm(Number(state.display)), op: '×' };
        } else {
          frame = { accVal: null, accStr: null, op: null };
        }
        return {
          ...state,
          acc: null,
          pendingOp: null,
          display: '0',
          freshEntry: true,
          segExpr: null,
          parenStack: [...state.parenStack, frame],
        };
      }
      // close：栈空 no-op；否则先算完内层段，弹栈回填为外层右操作数
      if (state.parenStack.length === 0) return state;
      let val: number;
      let str: string;
      if (state.pendingOp !== null) {
        const left = state.acc as number;
        const right = Number(state.display);
        if (state.pendingOp === '÷' && right === 0) return errored(state, DIV_ZERO_MSG);
        val = apply(left, state.pendingOp, right);
        str =
          state.segExpr !== null
            ? `${norm(left)} ${opSym(state.pendingOp)} (${state.segExpr})`
            : `${norm(left)} ${opSym(state.pendingOp)} ${norm(right)}`;
      } else {
        val = Number(state.display);
        str = state.segExpr ?? norm(val);
      }
      const stack = [...state.parenStack];
      const top = stack.pop() as CalcParenFrame;
      return {
        ...state,
        acc: top.op !== null ? top.accVal : null,
        pendingOp: top.op,
        display: norm(val),
        freshEntry: true,
        segExpr: str,
        parenStack: stack,
      };
    }

    case 'percent': {
      if (state.error) return state;
      // 语义：当前值÷100（乘法场景主导：1500 × 5% = 75）
      return { ...state, display: norm(Number(state.display) / 100), freshEntry: true, segExpr: null };
    }

    case 'negate': {
      if (state.error || state.display === '0') return state;
      return {
        ...state,
        display: state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`,
        segExpr: null,
      };
    }

    case 'backspace': {
      // 错误态/结果态（freshEntry）不可退格——结果不是可编辑文本
      if (state.error || state.freshEntry) return state;
      const next = state.display.slice(0, -1);
      // 终审 F7：'-0.' 退到 '-0' 时归一为 '0'——防停驻 '-0' 后续输显示 '-012'
      return { ...state, display: next === '' || next === '-' || next === '-0' ? '0' : next };
    }

    case 'clear':
      // 重置运算态（含括号栈），保留 history 与角度模式（模式是偏好不是运算态）
      return { ...initialCalcState, history: state.history, angleMode: state.angleMode };

    case 'useHistory':
      return { ...state, display: action.value, freshEntry: true, error: null, segExpr: null };

    case 'unary': {
      if (state.error) return state;
      const v = Number(state.display);
      if (action.fn === 'inv' && v === 0) return errored(state, DIV_ZERO_MSG);
      const out = applyUnary(v, action.fn, state.angleMode);
      if (out === null) return errored(state, DOMAIN_MSG);
      // 函数结果不进 history（仅 = 记账，Casio 惯例）；结果后新数字重新起数
      return { ...state, display: norm(out), freshEntry: true, segExpr: null };
    }

    case 'constant': {
      if (state.error) return state;
      const v = action.kind === 'pi' ? Math.PI : Math.E;
      return { ...state, display: norm(v), freshEntry: true, segExpr: null };
    }

    case 'toggleAngle':
      return { ...state, angleMode: state.angleMode === 'DEG' ? 'RAD' : 'DEG' };

    default:
      return state;
  }
}

/** 键盘键 → 动作映射；无映射（含 Escape）返回 null——组件层自行处理关弹层 */
export function keyToAction(key: string): CalcAction | null {
  if (key.length === 1 && (DIGITS as readonly string[]).includes(key)) {
    return { type: 'digit', d: key as CalcDigit };
  }
  switch (key) {
    case '.':
      return { type: 'dot' };
    case '+':
      return { type: 'op', op: '+' };
    case '-':
      return { type: 'op', op: '-' };
    case '*':
    case 'x':
    case 'X':
      return { type: 'op', op: '×' };
    case '^':
      return { type: 'op', op: '^' };
    case '/':
      return { type: 'op', op: '÷' };
    case 'Enter':
    case '=':
      return { type: 'equals' };
    case 'Backspace':
      return { type: 'backspace' };
    case 'c':
    case 'C':
      return { type: 'clear' };
    case '%':
      return { type: 'percent' };
    case '(':
      return { type: 'paren', kind: 'open' };
    case ')':
      return { type: 'paren', kind: 'close' };
    default:
      return null;
  }
}

/** 视图千分位格式化（保留尾部小数点与负号；仅无 error 时由组件调用） */
export function formatCalcDisplay(raw: string): string {
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const [int, dec] = body.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = dec === undefined ? grouped : `${grouped}.${dec}`;
  return neg ? `-${out}` : out;
}

/** 待算式行（组件显示用）：acc 必须经 norm 消浮点噪声（终审 F1——acc 是原始双精度，
 *  0.1+0.2 链式挂 op 后为 0.30000000000000004，裸 String 会把噪声漏到待算式行） */
export function calcExprLine(state: CalcState): string {
  if (state.acc === null || !state.pendingOp) return '';
  return `${formatCalcDisplay(norm(state.acc))} ${state.pendingOp}`;
}
