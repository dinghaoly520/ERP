'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calculator } from 'lucide-react';
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
 * 评标工作台·通用计算器（2026-11-20 v1）——挂 evaluate 页顶部导航「开标消息/澄清答疑」左侧。
 * 常驻挂载（开合不丢状态/历史；切项目/重挂载时整体重置）。
 * 弹层 createPortal + fixed：右栏 aside overflow-hidden 且可缩至 15%，就地 absolute
 * 会被裁切（cgzxui SearchSelect 先例——portal 挂 body 摆脱窄列/overflow 裁切）。
 * 键盘仅在弹层聚焦时生效（容器 onKeyDown，不挂 window 监听）；Escape 只关计算器，
 * stopPropagation 防同时触发面板全屏退出（requirement-compare-panel 的 window 监听）。
 */

interface CalcKey {
  label: string;
  act: CalcAction;
  cls?: string;
}

const digit = (n: CalcDigit): CalcAction => ({ type: 'digit', d: n });
const opAct = (op: '+' | '-' | '×' | '÷'): CalcAction => ({ type: 'op', op });

const KEY_ROWS: CalcKey[][] = [
  [
    { label: 'C', act: { type: 'clear' }, cls: 'is-danger' },
    { label: '⌫', act: { type: 'backspace' }, cls: 'is-warning' },
    { label: '%', act: { type: 'percent' }, cls: 'is-warning' },
    { label: '÷', act: opAct('÷'), cls: 'is-info' },
  ],
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
    { label: '±', act: { type: 'negate' }, cls: 'is-info' },
    { label: '0', act: digit('0') },
    { label: '.', act: { type: 'dot' } },
    { label: '=', act: { type: 'equals' }, cls: 'is-info font-bold' },
  ],
];

export function CalculatorPopover({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(calcReducer, initialCalcState);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 打开：按触发钮矩形定位（右缘对齐、向下弹）；窗口尺寸变化即关（SearchSelect 同款语义，
  // 终审 F4：关后还焦触发钮——resize 无自然落焦目标，不还焦会掉到 body）
  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    const onResize = () => {
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  // 打开即聚焦弹层（吃键盘）；关闭还焦触发钮
  useEffect(() => {
    if (open) popRef.current?.focus();
  }, [open, pos]);

  // 点外关闭（触发钮与弹层之外的 pointerdown）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const closePopover = () => {
    setOpen(false);
    btnRef.current?.focus();
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
          // 定位壳：fixed 必须走内联 style——globals.css 的 .neu-card-static 是 unlayered
          // `position:relative`，Tailwind v4 utilities 在 @layer 内恒被其压过（验收实录：
          // 弹层被相对定位偏移到页面左下角容器外）。内层保 neu-card-static 视觉。
          <div style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 70 }}>
          <div
            ref={popRef}
            role="dialog"
            aria-label="计算器"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
              // 终审 F6：焦点离开弹层即收起——防 Tab 逃逸后 Escape 直击 window（语义反转：
              // 面板全屏被退、计算器却还开着）。relatedTarget 仍在弹层内（键钮间移动）不收。
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
            }}
            className="neu-card-static w-[248px] !rounded-[16px] p-3 focus:outline-none"
          >
            {/* 显示区：待算式小字 + 主显示（mono 表格数字；终审 F3 truncate 防超宽，title 悬停看全值） */}
            <div className="rounded-[12px] bg-[oklch(0.96_0.01_258/0.35)] px-3 py-2 text-right">
              <div className="h-4 truncate font-mono text-[10px] leading-4 text-[var(--muted-foreground)]" title={exprLine}>
                {exprLine}
              </div>
              {state.error ? (
                <div className="text-[13px] font-bold text-[var(--danger)]">{state.error}</div>
              ) : (
                <div
                  className="truncate font-mono text-xl font-bold tabular-nums leading-7 text-[var(--foreground)]"
                  title={formatCalcDisplay(state.display)}
                >
                  {formatCalcDisplay(state.display)}
                </div>
              )}
            </div>

            {/* 历史条：≤5 条，点击回填结果 */}
            {state.history.length > 0 && (
              <div className="mt-2 max-h-[76px] overflow-y-auto rounded-[10px] bg-[oklch(0.96_0.01_258/0.3)] px-1.5 py-1">
                {state.history.map((h, i) => (
                  <button
                    key={`${h.expr}|${h.result}|${i}`}
                    type="button"
                    title="点击回填结果"
                    onClick={() => dispatch({ type: 'useHistory', value: h.result })}
                    className="block w-full rounded px-1.5 py-0.5 text-right font-mono text-[10px] tabular-nums text-[var(--muted-foreground)] transition-colors hover:bg-[oklch(0.96_0.04_251/0.25)] hover:text-[var(--foreground)]"
                  >
                    {h.expr} = {h.result}
                  </button>
                ))}
              </div>
            )}

            {/* 键区 5×4 */}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {KEY_ROWS.flat().map((k) => (
                <button
                  key={k.label}
                  type="button"
                  onClick={() => dispatch(k.act)}
                  className={`neu-btn-xs !h-9 !px-0 font-mono !text-[13px] ${k.cls ?? ''}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}
