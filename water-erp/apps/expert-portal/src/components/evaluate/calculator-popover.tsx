'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calculator, Grip, X } from 'lucide-react';
import {
  initialCalcState,
  calcReducer,
  keyToAction,
  formatCalcDisplay,
  calcExprLine,
  type CalcAction,
  type CalcDigit,
} from '@/lib/calculator-core';

/**
 * 评标工作台·通用计算器浮窗（2026-11-20 v1.5）——挂 evaluate 页顶部导航「开标消息/澄清答疑」左侧。
 * 浮窗语义：不透明底、标题栏拖拽、右下角限界缩放（MIN/MAX_SIZE）；常驻不随点外/失焦关闭
 * （工具窗叠在工作页上操作，误触关闭反而丢上下文），关闭= X 钮 / Escape（聚焦时）。
 * 状态常驻挂载（开合不丢；切项目重挂载即重置）。定位壳必须内联 position:fixed——globals.css
 * 的 .neu-card-static 是 unlayered position:relative，Tailwind v4 utilities 在 @layer 内恒被压过。
 * 键盘仅在弹窗聚焦时生效（容器 onKeyDown，不挂 window 监听）；Escape 只关计算器，
 * stopPropagation 防同时触发面板全屏退出（requirement-compare-panel 的 window 监听）。
 */

interface CalcKey {
  label: string;
  act: CalcAction;
  cls?: string;
  /** DEG/RAD 切换键：label 由 state.angleMode 动态渲染 */
  isAngle?: boolean;
}

const digit = (n: CalcDigit): CalcAction => ({ type: 'digit', d: n });
const opAct = (op: '+' | '-' | '×' | '÷' | '^'): CalcAction => ({ type: 'op', op });
const un = (fn: 'sin' | 'cos' | 'tan' | 'ln' | 'log' | 'sqrt' | 'sqr' | 'inv'): CalcAction => ({ type: 'unary', fn });

/** v2 科学函数区（4 行：3 行函数 + 1 行括号/编辑键；一元按下即算；xʸ 入运算链；DEG/RAD 切换） */
const SCI_ROWS: CalcKey[][] = [
  [
    { label: 'sin', act: un('sin') },
    { label: 'cos', act: un('cos') },
    { label: 'tan', act: un('tan') },
    { label: 'π', act: { type: 'constant', kind: 'pi' } },
  ],
  [
    { label: 'ln', act: un('ln') },
    { label: 'log', act: un('log') },
    { label: '√', act: un('sqrt') },
    { label: 'x²', act: un('sqr') },
  ],
  [
    { label: '1/x', act: un('inv') },
    { label: 'xʸ', act: opAct('^'), cls: 'is-info' },
    { label: '±', act: { type: 'negate' }, cls: 'is-info' },
    { label: 'DEG', act: { type: 'toggleAngle' }, cls: 'is-info', isAngle: true },
  ],
  [
    { label: '(', act: { type: 'paren', kind: 'open' } },
    { label: ')', act: { type: 'paren', kind: 'close' } },
    { label: '⌫', act: { type: 'backspace' }, cls: 'is-warning' },
    { label: '%', act: { type: 'percent' }, cls: 'is-warning' },
  ],
];

const KEY_ROWS: CalcKey[][] = [
  [
    { label: '7', act: digit('7') },
    { label: '8', act: digit('8') },
    { label: '9', act: digit('9') },
    { label: '×', act: opAct('×'), cls: 'is-info' },
  ],
  [
    { label: '4', act: digit('4') },
    { label: '5', act: digit('5') },
    { label: '6', act: digit('6') },
    { label: '−', act: opAct('-'), cls: 'is-info' },
  ],
  [
    { label: '1', act: digit('1') },
    { label: '2', act: digit('2') },
    { label: '3', act: digit('3') },
    { label: '+', act: opAct('+'), cls: 'is-info' },
  ],
  [
    { label: 'C', act: { type: 'clear' }, cls: 'is-danger' },
    { label: '0', act: digit('0') },
    { label: '.', act: { type: 'dot' } },
    { label: '=', act: { type: 'equals' }, cls: 'is-info font-bold' },
  ],
];

/** v2 窗口尺寸约束（科学键区 8 行 + 纸带显示，整体更高更宽） */
const INIT_SIZE = { w: 260, h: 540 };
const MIN_SIZE = { w: 232, h: 470 };
const MAX_SIZE = { w: 560, h: 800 };

/** 视口钳制：标题栏永不移出屏幕（至少留 48px 高度、80px 宽度可抓回） */
const clampPos = (left: number, top: number) => ({
  left: Math.max(0, Math.min(left, window.innerWidth - 80)),
  top: Math.max(0, Math.min(top, window.innerHeight - 48)),
});

export function CalculatorPopover({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(calcReducer, initialCalcState);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState(INIT_SIZE);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);
  /** 拖拽/缩放统一手势态（null=无手势；监听器常驻，无手势时 no-op） */
  const gestureRef = useRef<null | {
    mode: 'drag' | 'resize';
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    origW: number;
    origH: number;
  }>(null);

  // 打开：初始位置 = 右缘对齐触发钮（按当前窗宽）向下弹，视口内钳制
  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos(clampPos(r.right - sizeRef.current.w, r.bottom + 8));
  }, [open]);

  // 视口尺寸变化：浮窗钳回屏内（浮窗常驻，不再直接关）
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p.left, p.top) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 打开即聚焦弹窗（吃键盘）
  useEffect(() => {
    if (open) popRef.current?.focus();
  }, [open, pos]);

  // 纸带自动滚到底（最新在底部）
  useEffect(() => {
    const el = tapeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.history]);

  const closePopover = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  // 拖拽（标题栏）/ 缩放（右下角 grip）：pointer 手势，位移自起点增量计算（无 stale state）
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (g.mode === 'drag') {
        setPos(clampPos(g.origLeft + dx, g.origTop + dy));
      } else {
        setSize({
          w: Math.max(MIN_SIZE.w, Math.min(MAX_SIZE.w, g.origW + dx)),
          h: Math.max(MIN_SIZE.h, Math.min(MAX_SIZE.h, g.origH + dy)),
        });
      }
    };
    const up = () => {
      gestureRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const startGesture = (mode: 'drag' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0 || !pos) return;
    e.preventDefault(); // 防拖动时选中文字/触发触摸滚动
    gestureRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: pos.left,
      origTop: pos.top,
      origW: sizeRef.current.w,
      origH: sizeRef.current.h,
    };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // 只关计算器，不触发面板全屏退出（window 监听）
      closePopover();
      return;
    }
    const action = keyToAction(e.key);
    if (action) {
      e.preventDefault(); // '/' 防 Firefox 快速查找、Backspace 防历史导航
      e.stopPropagation();
      dispatch(action);
    }
  };

  // 待算式行走核心 calcExprLine（acc 经 norm 消浮点噪声，终审 F1 修复）
  const exprLine = calcExprLine(state);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`neu-btn-xs is-info shrink-0 ${className}`}
      >
        <Calculator size={13} strokeWidth={1.5} /> 计算器
      </button>

      {open &&
        pos &&
        createPortal(
          // 定位壳：fixed 走内联 style（unlayered position:relative 压过 Tailwind fixed，验收实录）
          <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 70 }}>
          <div
            ref={popRef}
            role="dialog"
            aria-label="计算器"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="exp-calc-shell neu-card-static flex select-none flex-col overflow-hidden !rounded-[16px] p-3 focus:outline-none"
            style={{ width: size.w, height: size.h }}
          >
            {/* 标题栏：拖拽手柄（左标签 + 右关闭） */}
            <div
              className="flex shrink-0 cursor-move touch-none items-center justify-between pb-2"
              onPointerDown={startGesture('drag')}
            >
              <span className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--muted-foreground)]">
                <Calculator size={11} strokeWidth={1.5} /> 计算器
              </span>
              <button
                type="button"
                onClick={closePopover}
                onPointerDown={(e) => e.stopPropagation()}
                className="neu-btn-xs is-square !h-6 !w-6"
                aria-label="关闭计算器"
              >
                <X size={13} strokeWidth={1.5} />
              </button>
            </div>

            {/* 纸带显示区（v2 加高）：历史行（可点回填，最新在下）+ 当前算式/主显示固定底部 */}
            <div className="flex min-h-[120px] flex-1 flex-col overflow-hidden rounded-[12px] bg-[oklch(0.96_0.01_258/0.35)]">
              <div ref={tapeRef} className="flex-1 overflow-y-auto px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[...state.history].reverse().map((h, i) => (
                  <button
                    key={`${h.expr}|${h.result}|${i}`}
                    type="button"
                    title="点击回填结果"
                    onClick={() => dispatch({ type: 'useHistory', value: h.result })}
                    className="block w-full rounded px-1 py-0.5 text-right font-mono text-[11px] tabular-nums text-[var(--muted-foreground)] transition-colors hover:bg-[oklch(0.96_0.04_251/0.25)] hover:text-[var(--foreground)]"
                  >
                    {h.expr} = {h.result}
                  </button>
                ))}
              </div>
              <div className="shrink-0 px-3 pb-2 pt-1 text-right">
                <div className="flex h-4 items-center gap-2">
                  {state.parenStack.length > 0 && (
                    <span className="shrink-0 font-mono text-[10px] font-bold text-[var(--accent)]" title={`未闭合括号 ${state.parenStack.length} 层`}>
                      ( ×{state.parenStack.length}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 truncate text-right font-mono text-[10px] leading-4 text-[var(--muted-foreground)]" title={exprLine}>
                    {exprLine}
                  </div>
                </div>
                {state.error ? (
                  <div className="text-[13px] font-bold text-[var(--danger)]">{state.error}</div>
                ) : (
                  <div
                    className="truncate font-mono text-xl font-bold tabular-nums leading-7 text-[var(--foreground)]"
                    title={`${formatCalcDisplay(state.display)}${state.entryPercent ? '%' : ''}`}
                  >
                    {formatCalcDisplay(state.display)}
                    {state.entryPercent ? '%' : ''}
                  </div>
                )}
              </div>
            </div>

            {/* 键区：科学函数 3 行 + 主键区 5 行，auto-rows-fr 随窗口高度拉伸 */}
            <div className="mt-2 grid shrink-0 auto-rows-fr grid-cols-4 gap-1.5">
              {[...SCI_ROWS, ...KEY_ROWS].flat().map((k) => (
                <button
                  key={k.label}
                  type="button"
                  onClick={() => dispatch(k.act)}
                  className={`neu-btn-xs !px-0 font-mono !text-[13px] ${k.cls ?? ''}`}
                >
                  {k.isAngle ? state.angleMode : k.label}
                </button>
              ))}
            </div>

            {/* 右下角缩放手柄（SE 方向，MIN/MAX_SIZE 钳制） */}
            <div
              className="absolute bottom-0.5 right-0.5 flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center text-[var(--muted-foreground)]"
              onPointerDown={startGesture('resize')}
              role="separator"
              aria-label="拖拽调整计算器大小"
            >
              <Grip size={12} strokeWidth={1.5} />
            </div>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}
