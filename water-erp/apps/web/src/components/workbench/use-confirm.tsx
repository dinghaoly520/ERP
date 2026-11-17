'use client';
/**
 * 全端 confirm 普查专批（2026-09-09）：原生 confirm 弹窗 → 受控确认弹窗统一钩子。
 * 用 wb-overlay-backdrop + wb-modal-shell 手写壳（非 workbench Modal）——可在已打开的 Modal 上层叠加，
 * 规避「同一时刻至多一个 Modal」约束。confirm() 返回 Promise<boolean>，调用点 await 后语义与原生
 * 确认框完全一致（true=确认）。z-[700] 盖过 workbench Modal 的 z-[600]。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

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

  // 弹窗规范 A 版·紧凑变体（2026-11-16 迁移，配色维持原样）：图标井头部 + hairline 隔离线 +
  // 内容区呼吸距 + 底栏分割线，布局/字阶与共享 Modal 完全同构；z-[700] 叠层能力保留（可盖在 Modal 上）
  const dialog = state ? (
    <div className="fixed inset-0 z-[700] flex items-center justify-center p-4">
      <div className="wb-overlay-backdrop" onClick={() => close(false)} />
      <div
        className="wb-modal-shell relative flex w-full max-w-[min(420px,92vw)] flex-col overflow-hidden outline-none"
        role="alertdialog"
        aria-modal="true"
        aria-label={state.title ?? '确认操作'}
      >
        {/* 标题栏 — 图标井 + 动词标题（与共享 Modal 同款排版） */}
        <div className="flex shrink-0 items-start gap-3 px-6 pt-6 pb-4">
          <span className="neu-icon-well mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[var(--accent)]">
            <AlertTriangle size={14} />
          </span>
          <h2 className="text-lg font-bold leading-relaxed tracking-[-0.02em] text-[var(--foreground)]">{state.title ?? '确认操作'}</h2>
        </div>
        {/* 头部/内容隔离线（与共享 Modal 同款） */}
        <div className="mx-6 h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />
        {/* 内容区（compact：pt-4 呼吸距 / pb-2 收身） */}
        <div className="px-6 pt-4 pb-2">
          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--foreground)]">{state.message}</p>
        </div>
        {/* 底部操作栏（compact：pt-2/pb-4 + 分割线 mb-3）——按钮配色按业务语义（2026-11-16 用户裁定）：
            破坏性（删除/移除/隐藏，danger=true）：取消=黑（is-porcelain 墨字）/ 确认=红（is-danger）；
            正向/中性（danger=false）：取消=红 / 确认=灰（soft 默认灰字） */}
        <div className="shrink-0 px-6 pb-4 pt-2">
          <hr className="wb-section-rule mb-3" />
          <div className="flex justify-end gap-3">
            <button type="button" className={`neu-btn-soft ${state.danger ? 'is-porcelain' : 'is-danger'}`} onClick={() => close(false)}>取消</button>
            <button
              type="button"
              autoFocus
              className={state.danger ? 'neu-btn-primary is-water is-danger !h-[38px]' : 'neu-btn-soft'}
              onClick={() => close(true)}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
