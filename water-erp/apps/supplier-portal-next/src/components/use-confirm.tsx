'use client';
/**
 * confirm 普查专批（2026-09-09）：原生 confirm 弹窗 → 受控确认弹窗统一钩子。
 * 用门户通用弹窗原语 .gdlg-ov/.gdlg-pn 手写壳（非 SpDialog）——可在已打开的 SpDialog / ct-panel /
 * add-panel / app-dlg 等弹窗上层叠加，规避「同一时刻至多一个弹窗」的焦点陷阱冲突。
 * confirm() 返回 Promise<boolean>，调用点 await 后语义与原生确认框完全一致（true=确认）。
 * onConfirm 可选同步回调：在确认按钮 click 事件内同步执行，保留用户手势上下文（供 window.open 等
 * 受弹窗拦截策略约束的 API 使用）。
 * 内联 z-10001 盖过门户最高层级（水叮当浮层 z-10000）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

type ConfirmOptions = { title?: string; message: string; danger?: boolean; onConfirm?: () => void };

export function useConfirm() {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolverRef.current?.(false); // 二次调用：先结算上一个为取消（弹窗被替换）
    resolverRef.current = resolve;
    setState(opts);
  }), []);

  const close = useCallback((v: boolean) => { resolverRef.current?.(v); resolverRef.current = null; setState(null); }, []);

  // Esc 关闭（结算为取消）；confirm 按钮 autoFocus——键盘流打开即可回车确认
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  const dialog = state ? (
    <div
      className="gdlg-ov"
      style={{ zIndex: 10001 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
    >
      <div className="gdlg-pn max-w-full" style={{ width: 440 }} role="alertdialog" aria-modal="true" aria-label={state.title ?? '确认操作'}>
        <div className="gdlg-h">
          <h2 className="gdlg-t">{state.title ?? '确认操作'}</h2>
          <button type="button" className="gdlg-x" onClick={() => close(false)} aria-label="关闭">
            <X size={18} strokeWidth={1.85} />
          </button>
        </div>
        <div className="gdlg-b">
          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--muted-foreground)]">{state.message}</p>
        </div>
        <div className="gdlg-ft">
          <button type="button" className="neu-btn-soft" onClick={() => close(false)}>取消</button>
          <button type="button" autoFocus className={`neu-btn-primary${state.danger ? ' is-danger' : ''}`} onClick={() => { state.onConfirm?.(); close(true); }}>确认</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
