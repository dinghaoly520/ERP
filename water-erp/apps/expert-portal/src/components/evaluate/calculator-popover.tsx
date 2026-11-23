'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calculator, ChevronDown, Grip, X } from 'lucide-react';
import { evaluateCalc, normalizeExprChars, type AngleMode, type CalcHistoryEntry } from '@/lib/calculator-core';

/**
 * 评标工作台·表达式计算器浮窗（v3，2026-11-20 用户裁定重构）。
 * 模型：算式是可编辑文本（原生 input——鼠标点击定位/框选/方向键/小键盘全部原生），
 * 点击 = 才求值，中间不做任何分步计算；键盘 * / - 输入即时归一为 × ÷ −。
 * 文法/求值在 lib/calculator-core（tokenizer+递归下降，参照 expr-eval 优先级表）。
 * 浮窗语义（v1.5 起）：不透明底、标题栏拖拽、右下角限界缩放、常驻不随点外/失焦关闭，
 * 关闭=X 钮/Escape。定位壳必须内联 position:fixed（globals.css 的 .neu-card-static 是
 * unlayered position:relative，Tailwind v4 utilities 在 @layer 内恒被压过）。
 */

interface CalcKey {
  label: string;
  ins?: string; // 插入光标处的文本（缺省=label）
  cls?: string;
  isAngle?: boolean; // DEG/RAD 切换键
  act?: 'backspace' | 'clear' | 'equals';
}

const K = (label: string, cls?: string, ins?: string): CalcKey => ({ label, cls, ins });
const SCI_ROWS: CalcKey[][] = [
  [K('sin', '', 'sin('), K('cos', '', 'cos('), K('tan', '', 'tan('), K('π')],
  [K('ln', '', 'ln('), K('log', '', 'log('), K('√', '', '√('), K('x²', '', '^2')],
  [K('1/x', '', '1÷('), K('xʸ', 'is-info', '^'), K('%'), { label: 'DEG', cls: 'is-info', isAngle: true }],
  [K('(', 'is-info'), K(')', 'is-info'), { label: '⌫', cls: 'is-warning', act: 'backspace' }, { label: 'C', cls: 'is-danger', act: 'clear' }],
];
const KEY_ROWS: CalcKey[][] = [
  [K('7'), K('8'), K('9'), K('÷', 'is-info')],
  [K('4'), K('5'), K('6'), K('×', 'is-info')],
  [K('1'), K('2'), K('3'), K('−', 'is-info')],
  [K('+', 'is-info'), K('0'), K('.'), { label: '=', cls: 'is-info font-bold', act: 'equals' }],
];

/** 窗口尺寸约束（右下角 grip 拖拽缩放） */
const INIT_SIZE = { w: 268, h: 548 };
const MIN_SIZE = { w: 236, h: 480 };
const MAX_SIZE = { w: 560, h: 800 };
const HISTORY_CAP = 12;

/** 视口钳制：标题栏永不移出屏幕 */
const clampPos = (left: number, top: number) => ({
  left: Math.max(0, Math.min(left, window.innerWidth - 80)),
  top: Math.max(0, Math.min(top, window.innerHeight - 48)),
});

const LEADS_OPERATOR = /^[+−×÷^%]/;

export function CalculatorPopover({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState(INIT_SIZE);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // ── 计算器状态：表达式文本 + 结果 + 历史 + 角度模式 ──
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState<string | null>(null); // 最近一次 = 的结果
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CalcHistoryEntry[]>([]);
  const [angleMode, setAngleMode] = useState<AngleMode>('DEG');
  /** 刚求值完：下一个输入若为运算符则接在结果后（Ans 延续），否则重新起式 */
  const justEvaluatedRef = useRef(false);
  /** 历史纸带折叠态（默认展开；点头部行切换） */
  const [historyOpen, setHistoryOpen] = useState(true);

  // 打开：初始位置 = 右缘对齐触发钮（按当前窗宽）向下弹；聚焦输入框
  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos(clampPos(r.right - sizeRef.current.w, r.bottom + 8));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // 视口尺寸变化：浮窗钳回屏内
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p.left, p.top) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 纸带自动滚到底（最新在底部）
  useEffect(() => {
    const el = tapeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  // 拖拽（标题栏）/ 缩放（右下角 grip）
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
    window.addEventListener('pointercancel', up); // 终审#2：系统取消手势（触屏让位等）
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const startGesture = (mode: 'drag' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0 || !pos) return;
    e.preventDefault();
    // 终审#2：指针捕获——拖出浏览器视口后释放，pointerup 仍派发到捕获元素（经 window 冒泡监听收到），
    // 防 gestureRef 悬置导致「鼠标回窗后浮窗粘着光标直到下次点击」
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 不支持捕获的环境退化为 window 监听（指针回窗前的移动丢失，可接受） */
    }
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

  const closePopover = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  // ── 求值（只在 = 时发生）──
  const doEvaluate = () => {
    const r = evaluateCalc(expr, angleMode);
    if (!r.ok) {
      setError(r.error);
      setResult(null);
      requestAnimationFrame(() => inputRef.current?.focus()); // 终审#4：动作后回焦，防 Escape 泄给 window
      return;
    }
    setResult(r.text);
    setError(null);
    justEvaluatedRef.current = true;
    // 终审#8：连续重复 = 不追加重复历史行
    setHistory((h) =>
      h[0] && h[0].expr === expr && h[0].result === r.text
        ? h
        : [{ expr, result: r.text }, ...h].slice(0, HISTORY_CAP),
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** 键钮：在光标处插入文本（框选则替换）；刚求值完按运算符=结果延续、其余=重新起式 */
  const insertToken = (token: string) => {
    const el = inputRef.current;
    setError(null);
    if (justEvaluatedRef.current) {
      const next = LEADS_OPERATOR.test(token) && result !== null ? result + token : token;
      justEvaluatedRef.current = false;
      setExpr(next);
      requestAnimationFrame(() => {
        el?.setSelectionRange(next.length, next.length);
        el?.focus();
      });
      return;
    }
    if (!el) {
      setExpr((s) => s + token);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setExpr(next);
    requestAnimationFrame(() => {
      el.setSelectionRange(start + token.length, start + token.length);
      el.focus();
    });
  };

  /** ⌫：删除光标前一字符（框选则删选中段） */
  const doBackspace = () => {
    const el = inputRef.current;
    setError(null);
    justEvaluatedRef.current = false;
    if (!el) {
      setExpr((s) => s.slice(0, -1));
      return;
    }
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    if (s === e && s === 0) return;
    const next = s === e ? el.value.slice(0, s - 1) + el.value.slice(s) : el.value.slice(0, s) + el.value.slice(e);
    setExpr(next);
    const caret = s === e ? s - 1 : s;
    requestAnimationFrame(() => {
      el.setSelectionRange(caret, caret);
      el.focus();
    });
  };

  const doClear = () => {
    setExpr('');
    setResult(null);
    setError(null);
    justEvaluatedRef.current = false;
    inputRef.current?.focus();
  };

  /** 历史回填：载入该条算式继续编辑 */
  const loadHistory = (h: CalcHistoryEntry) => {
    setExpr(h.expr);
    setResult(h.result);
    setError(null);
    justEvaluatedRef.current = false;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.setSelectionRange(h.expr.length, h.expr.length);
      el?.focus();
    });
  };

  const onKeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // 只关计算器，不触发面板全屏退出（window 监听）
      closePopover();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      doEvaluate();
    }
    // 其余按键（数字/运算符/括号/方向键/Home/End/小键盘）全部走 input 原生编辑
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 键盘 * / - 即时归一为显示形（1:1 替换不动光标）
    setExpr(normalizeExprChars(e.target.value));
    setError(null);
    justEvaluatedRef.current = false;
  };

  const onKeyButton = (k: CalcKey) => {
    if (k.act === 'backspace') return doBackspace();
    if (k.act === 'clear') return doClear();
    if (k.act === 'equals') return doEvaluate();
    if (k.isAngle) {
      setAngleMode((m) => (m === 'DEG' ? 'RAD' : 'DEG'));
      requestAnimationFrame(() => inputRef.current?.focus()); // 终审#4
      return;
    }
    return insertToken(k.ins ?? k.label);
  };

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
            role="dialog"
            aria-label="计算器"
            className="exp-calc-shell neu-card-static flex select-none flex-col overflow-hidden !rounded-[16px] p-3 focus:outline-none"
            style={{ width: size.w, height: size.h }}
          >
            {/* 标题栏：拖拽手柄（左标签 + 右关闭） */}
            <div
              className="flex shrink-0 cursor-move touch-none items-center justify-between pb-2"
              onPointerDown={startGesture('drag')}
            >
              <span className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--foreground)]">
                <Calculator size={11} strokeWidth={1.5} /> 计算器
              </span>
              <button
                type="button"
                onClick={closePopover}
                onPointerDown={(e) => e.stopPropagation()}
                className="neu-btn-xs is-square !h-6 !w-6 !min-h-6"
                aria-label="关闭计算器"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>

            {/* 算式输入框（可点击编辑/框选/小键盘原生输入）+ 结果行 */}
            <div className="flex shrink-0 flex-col gap-2.5 rounded-[12px] bg-[oklch(0.96_0.01_258/0.35)] px-3 py-4">
              <input
                ref={inputRef}
                type="text"
                value={expr}
                onChange={onInputChange}
                onKeyDown={onKeyKeyDown}
                spellCheck={false}
                autoComplete="off"
                aria-label="算式输入"
                className="w-full bg-transparent !p-0 font-mono text-[21px] leading-[44px] tracking-tight text-[var(--foreground)] outline-none placeholder:text-[var(--foreground)]/60"
              />
              <div className="h-11 text-right font-mono text-2xl font-bold tabular-nums leading-[44px]">
                {error ? (
                  <span className="text-[12px] font-bold text-[var(--danger)]">{error}</span>
                ) : result !== null ? (
                  <span className="text-[var(--foreground)]">= {result}</span>
                ) : (
                  <span className="text-[var(--foreground)]">=</span>
                )}
              </div>
            </div>

            {/* 历史区（可折叠）：头部切换行 + 纸带（点击条目载入算式继续编辑） */}
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
                className="mt-2 flex w-full shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] font-bold tracking-wide text-[var(--foreground)]"
              >
                <ChevronDown size={11} strokeWidth={1.5} className={`shrink-0 transition-transform ${historyOpen ? '' : '-rotate-90'}`} />
                历史 <span className="font-mono">{history.length}</span>
              </button>
            )}
            {history.length > 0 && historyOpen && (
              <div
                ref={tapeRef}
                className="mt-1 min-h-[36px] flex-1 overflow-y-auto rounded-[10px] bg-[oklch(0.96_0.01_258/0.3)] px-1.5 py-1"
              >
                {/* 终审#1：数组最新在前 → 反转渲染为最新在底，配合滚到底始终可见最新条目 */}
                {[...history].reverse().map((h, i) => (
                  <button
                    key={`${h.expr}|${h.result}|${i}`}
                    type="button"
                    title="点击载入此算式继续编辑"
                    onClick={() => loadHistory(h)}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-[var(--foreground)] transition-colors hover:bg-[oklch(0.96_0.04_251/0.25)]"
                  >
                    {h.expr} = {h.result}
                  </button>
                ))}
              </div>
            )}

            {/* 键区：科学 4 行 + 主键区 4 行，auto-rows-fr 随窗口高度拉伸 */}
            <div className={`mt-2 grid auto-rows-fr grid-cols-4 gap-1.5 ${history.length > 0 && historyOpen ? 'shrink-0' : 'flex-1'}`}>
              {[...SCI_ROWS, ...KEY_ROWS].flat().map((k) => (
                <button
                  key={k.label}
                  type="button"
                  onClick={() => onKeyButton(k)}
                  className={`neu-btn-xs !px-0 font-mono !text-[15px] ${k.cls ?? ''}`}
                >
                  {k.isAngle ? angleMode : k.label}
                </button>
              ))}
            </div>

            {/* 右下角缩放手柄（SE 方向，MIN/MAX_SIZE 钳制） */}
            <div
              className="absolute bottom-0.5 right-0.5 flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center text-[var(--foreground)]"
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
