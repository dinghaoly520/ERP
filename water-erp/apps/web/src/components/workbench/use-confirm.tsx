'use client';
/**
 * 全端 confirm 普查专批（2026-09-09）：原生 confirm 弹窗 → 受控确认弹窗统一钩子。
 * 用 wb-overlay-backdrop + wb-modal-shell 手写壳（非 workbench Modal）——可在已打开的 Modal 上层叠加，
 * 规避「同一时刻至多一个 Modal」约束。confirm() 返回 Promise<boolean>，调用点 await 后语义与原生
 * 确认框完全一致（true=确认）。z-[700] 盖过 workbench Modal 的 z-[600]。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type ConfirmOptions = { title?: string; message: string; danger?: boolean };

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
    <div className="fixed inset-0 z-[700] flex items-center justify-center">
      <div className="wb-overlay-backdrop" onClick={() => close(false)} />
      <div className="relative w-full max-w-[420px] wb-modal-shell px-6 py-5" role="alertdialog" aria-modal="true" aria-label={state.title ?? '确认操作'}>
        <h3 className="text-base font-black text-[var(--foreground)]">{state.title ?? '确认操作'}</h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--muted-foreground)]">{state.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="neu-btn-soft" onClick={() => close(false)}>取消</button>
          <button type="button" autoFocus className={`neu-btn-primary !h-[38px]${state.danger ? ' is-danger' : ''}`} onClick={() => close(true)}>确认</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
