/**
 * 通用计算器核心（2026-11-20）——「条款响应核对」右栏计算器 v1 的纯函数状态机。
 * 无 React/DOM 依赖；语义裁定见 docs/superpowers/specs/2026-11-20-expert-compare-calculator-design.md：
 * % = 当前值÷100；连按 = 重复上次运算；C 重置运算态但保留 history；
 * 错误态仅 digit/clear 有效（digit 自愈重新起数）；精度 toPrecision(12) 消浮点噪声。
 */

export type CalcOp = '+' | '-' | '×' | '÷';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type CalcDigit = (typeof DIGITS)[number];

export interface CalcHistoryEntry {
  expr: string;
  result: string;
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
  /** 最近计算记录，新的在前，≤5 条 */
  history: CalcHistoryEntry[];
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
  | { type: 'useHistory'; value: string };

export const initialCalcState: CalcState = {
  display: '0',
  acc: null,
  pendingOp: null,
  lastOperand: null,
  lastOp: null,
  freshEntry: true,
  error: null,
  history: [],
};

const MAX_ENTRY_LEN = 15;
const DIV_ZERO_MSG = '除数不能为 0';

/** 浮点噪声归一：12 位有效数字后回字符串（0.1+0.2 → "0.3"） */
const norm = (n: number): string => String(Number(n.toPrecision(12)));

const apply = (a: number, o: CalcOp, b: number): number =>
  o === '+' ? a + b : o === '-' ? a - b : o === '×' ? a * b : a / b;

const withHistory = (state: CalcState, entry: CalcHistoryEntry): CalcHistoryEntry[] =>
  [entry, ...state.history].slice(0, 5);

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
        };
      }
      if (state.freshEntry) return { ...state, display: action.d, freshEntry: false };
      if (state.display.length >= MAX_ENTRY_LEN) return state; // 输入上限
      if (state.display === '0') {
        return action.d === '0' ? state : { ...state, display: action.d };
      }
      return { ...state, display: state.display + action.d };
    }

    case 'dot': {
      if (state.error) return state;
      if (state.freshEntry) return { ...state, display: '0.', freshEntry: false };
      if (state.display.includes('.')) return state;
      return { ...state, display: `${state.display}.` };
    }

    case 'op': {
      if (state.error) return state;
      // 即时执行：已有待算运算符且右操作数已输入 → 先算再挂新运算符
      if (state.pendingOp !== null && !state.freshEntry) {
        const acc = apply(state.acc as number, state.pendingOp, Number(state.display));
        return { ...state, acc, display: norm(acc), pendingOp: action.op, freshEntry: true };
      }
      if (state.acc === null) {
        return { ...state, acc: Number(state.display), pendingOp: action.op, freshEntry: true };
      }
      // freshEntry 下改选运算符（5 + 后改 × 不重算）
      return { ...state, pendingOp: action.op, freshEntry: true };
    }

    case 'equals': {
      if (state.error) return state;
      if (state.pendingOp !== null) {
        const left = state.acc as number;
        const right = Number(state.display);
        if (state.pendingOp === '÷' && right === 0) {
          return {
            ...state,
            display: '0',
            acc: null,
            pendingOp: null,
            lastOperand: null,
            lastOp: null,
            freshEntry: true,
            error: DIV_ZERO_MSG,
          };
        }
        const display = norm(apply(left, state.pendingOp, right));
        const expr = `${norm(left)} ${state.pendingOp} ${norm(right)}`;
        return {
          ...state,
          display,
          acc: null,
          pendingOp: null,
          lastOperand: right,
          lastOp: state.pendingOp,
          freshEntry: true,
          history: withHistory(state, { expr, result: display }),
        };
      }
      // 连按 = 重复上次运算
      if (state.lastOp !== null && state.lastOperand !== null) {
        const left = Number(state.display);
        if (state.lastOp === '÷' && state.lastOperand === 0) {
          return { ...state, display: '0', lastOperand: null, lastOp: null, freshEntry: true, error: DIV_ZERO_MSG };
        }
        const display = norm(apply(left, state.lastOp, state.lastOperand));
        const expr = `${norm(left)} ${state.lastOp} ${norm(state.lastOperand)}`;
        return {
          ...state,
          display,
          freshEntry: true,
          history: withHistory(state, { expr, result: display }),
        };
      }
      return state;
    }

    case 'percent': {
      if (state.error) return state;
      // 语义：当前值÷100（乘法场景主导：1500 × 5% = 75）
      return { ...state, display: norm(Number(state.display) / 100), freshEntry: true };
    }

    case 'negate': {
      if (state.error || state.display === '0') return state;
      return {
        ...state,
        display: state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`,
      };
    }

    case 'backspace': {
      // 错误态/结果态（freshEntry）不可退格——结果不是可编辑文本
      if (state.error || state.freshEntry) return state;
      const next = state.display.slice(0, -1);
      return { ...state, display: next === '' || next === '-' ? '0' : next };
    }

    case 'clear':
      // 重置运算态，保留 history
      return { ...initialCalcState, history: state.history };

    case 'useHistory':
      return { ...state, display: action.value, freshEntry: true, error: null };

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
