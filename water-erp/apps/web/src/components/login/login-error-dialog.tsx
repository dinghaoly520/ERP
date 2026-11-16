"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, X } from "lucide-react";

type LoginErrorDialogProps = {
  isOpen: boolean;
  message: string;
  onClose: () => void;
  /** 弹窗标题：登录页默认「登录失败」；复用于其他场景（如项目详情操作报错）时应传场景化标题 */
  title?: string;
};

export function LoginErrorDialog({
  isOpen,
  message,
  onClose,
  title = '登录失败',
}: LoginErrorDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // trap focus & Esc to close
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onKeyDown]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    // ── Backdrop ── z-[600] 必须盖过业务全屏 overlay（新建项目 z-[95]/详情面板 z-[120/121]/
    // workbench z-[500]；此前 z-50 被压住，错误框不可见且 body 滚动锁死，用户感知表单卡死）
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Dialog surface — A 版瓷面壳（2026-11-16 全系统推广，替换旧 neu-dialog 渐变壳） ── */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="wb-modal-shell relative z-10 flex w-full max-w-[420px] flex-col overflow-hidden"
      >
        {/* ── Header — 图标井头部 ── */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="neu-icon-well mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklch,var(--danger)_12%,oklch(0.99_0.004_258))] text-[color:var(--danger)]">
              <AlertCircle size={14} strokeWidth={1.8} />
            </span>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-[color:var(--foreground)]">
              {title}
            </h2>
          </div>
          <button onClick={onClose} className="neu-btn-xs" aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="mx-6 h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />

        {/* ── Message — plain text, no recessed card ── */}
        <div className="px-6 pt-4 pb-2">
          <p className="text-sm leading-6 text-[var(--foreground)]">
            {message}
          </p>
        </div>

        {/* ── Divider + Footer（紧凑；中性单钮=灰 soft） ── */}
        <div className="shrink-0 px-6 pb-4 pt-2">
          <hr className="wb-section-rule mb-3" />
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="neu-btn-soft">
              我知道了
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
