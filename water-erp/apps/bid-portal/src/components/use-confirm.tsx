'use client';
/**
 * 全端 confirm 普查专批（2026-09-09）：原生 confirm 弹窗 → 受控确认弹窗统一钩子（bid-portal 版）。
 * 用 bid-overlay + bid-overlay-backdrop + bid-dialog 三层手写壳（本门户标准弹窗结构，范本
 * signing-tab.tsx confirmBox）——可在已打开的弹窗上层叠加。confirm() 返回 Promise<boolean>，
 * 调用点 await 后语义与原生确认框完全一致（true=确认）。!z-[60] 盖过本门户弹窗
 * bid-overlay 的 z-index:50（globals.css 未分层声明，普通 z 工具类会在级联中落败，故用 !important）。
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
    <div className="bid-overlay !z-[60]" onClick={() => close(false)}>
      <div className="bid-overlay-backdrop" />
      <div className="bid-dialog relative mx-4 w-full max-w-[min(440px,92vw)] px-6 py-5" role="alertdialog" aria-modal="true" aria-label={state.title ?? '确认操作'} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-black text-[color:var(--foreground)]">{state.title ?? '确认操作'}</h3>
        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[color:var(--muted-foreground)]">{state.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="neu-btn-soft !h-8 !text-xs" onClick={() => close(false)}>取消</button>
          <button type="button" autoFocus className={`neu-btn-primary !h-8 !text-xs${state.danger ? ' is-danger' : ''}`} onClick={() => close(true)}>确认</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
