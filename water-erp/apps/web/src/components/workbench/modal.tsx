'use client';

import { useEffect, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';
const SIZE_PX: Record<ModalSize, number> = { sm: 420, md: 560, lg: 720, xl: 820, '2xl': 1080 };

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  /** Extra classes on the dialog surface (rarely needed). */
  className?: string;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'sm',
  closeOnBackdrop = true,
  closeOnEsc = true,
  className = '',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // On open: lock body scroll, remember & move focus. On close: restore.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const el = dialogRef.current;
    if (el) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        );
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [closeOnEsc, onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onKeyDown]);

  if (!open || typeof document === 'undefined') return null;

  const width = SIZE_PX[size];

  return createPortal(
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
      {/* z-[600]：必须盖过业务全屏 overlay（bid-confirm / score-standard 面板的 z-[500]），
          Modal 经 createPortal 挂到 body，与 overlay 同级层叠 */}
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        style={{ maxWidth: `min(${width}px, 92vw)` }}
        className={`relative flex w-full max-h-[90vh] flex-col rounded-[20px] bg-[var(--background)] shadow-[0_20px_60px_oklch(0.24_0.038_258/0.12)] outline-none ${className}`}
      >
        {/* 标题栏 — 固定不滚动 */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="mt-1 text-xs text-[var(--muted-foreground)]">
                {description}
              </p>
            )}
          </div>
          <button onClick={onClose} className="neu-btn-xs" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 内容区 — 仅此处滚动 */}
        <div className="flex-1 overflow-y-auto px-6">
          <div className="space-y-4 pb-4">{children}</div>
        </div>

        {/* 底部操作栏 — 固定不滚动 */}
        {footer && (
          <div className="shrink-0 px-6 pb-6 pt-3">
            <hr className="wb-section-rule mb-4" />
            <div className="flex justify-end gap-3">{footer}</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
