"use client";

/**
 * 供应商门户通用 UI 原语 — Element Plus 组件的 React 等价物。
 * 样式全部来自 globals.css（web 设计系统 neu-* + sp-* 移植层 + Part4 通用层），
 * 组件本身不含内联 style（cgzxui 规范）。
 */
import { useEffect, useId, useRef, useState, type ReactNode, type ComponentType, type RefObject } from "react";
import { X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── 按钮 ─── */
type ButtonVariant = "primary" | "soft" | "xs" | "link";
export function SpButton({
  variant = "soft",
  danger,
  success,
  warning,
  loading,
  icon: Icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  danger?: boolean;
  success?: boolean;
  warning?: boolean;
  loading?: boolean;
  icon?: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
}) {
  const base = variant === "primary" ? "neu-btn-primary" : variant === "xs" ? "neu-btn-xs" : variant === "link" ? "neu-btn-link" : "neu-btn-soft";
  const tone = danger ? " is-danger" : success ? " is-success" : warning ? " is-warning" : "";
  return (
    <button
      type="button"
      className={cn(base, tone, "inline-flex items-center gap-1.5", className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} strokeWidth={1.85} /> : null}
      {children}
    </button>
  );
}

/* ─── 表单控件（内凹风格统一走 neu-input / workbench-input）─── */
export function SpInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("neu-input", className)} {...rest} />;
}

export function SpTextarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("neu-input text-sm min-h-[88px] py-2.5", className)} {...rest} />;
}

export function SpSelect({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("workbench-input appearance-none pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function SpNumberInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" className={cn("workbench-input", className)} {...rest} />;
}

/** 原生 date / datetime-local 输入，样式与 workbench-input 一致 */
export function SpDateInput({ type = "date", className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { type?: "date" | "datetime-local" | "time" | "month" }) {
  return <input type={type} className={cn("workbench-input", className)} {...rest} />;
}

/* ─── 开关 ─── */
export function SpSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  "aria-label": ariaLabelAttribute,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? ariaLabelAttribute ?? "切换选项"}
      className={cn("sp-switch", checked && "on")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="sp-switch-knob" />
    </button>
  );
}

/* ─── 复选 / 单选 ─── */
export function SpCheckbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm cursor-pointer select-none", disabled && "opacity-50 cursor-not-allowed")}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function SpRadioGroup<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cn("sp-radio-chip", value === o.value && "on")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─── 通用弹窗（.gdlg-* — Part4 通用层；密码弹窗等专用样式另列）─── */
export function SpDialog({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  width = 520,
  footer,
  children,
  closeOnOverlay = true,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
  closeOnOverlay?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current = returnFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    document.body.style.overflow = "hidden";

    const focusableElements = () => {
      const dialog = dialogRef.current;
      if (!dialog) return [];
      return Array.from(dialog.querySelectorAll<HTMLElement>([
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","))).filter((element) => element.getAttribute("aria-hidden") !== "true");
    };

    const animationFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const initialFocus = dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?? focusableElements()[0]
        ?? dialog;
      initialFocus?.focus({ preventScroll: true });
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        elements[elements.length - 1].focus();
      } else if (!event.shiftKey && (currentIndex === -1 || currentIndex === elements.length - 1)) {
        event.preventDefault();
        elements[0].focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      const previouslyFocused = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // React 移除当前聚焦的弹窗节点时，浏览器会把焦点退回 body；延迟到下一帧再恢复触发器。
      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus({ preventScroll: true });
        }
      });
    };
  }, [open, returnFocusRef]);

  if (!open) return null;
  return (
    <div className="gdlg-ov" onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="gdlg-pn"
        style={{ width, maxWidth: "100%" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="gdlg-h">
          <div className="gdlg-hl">
            {Icon && (
              <div className="gdlg-hi">
                <Icon size={20} strokeWidth={1.75} />
              </div>
            )}
            <div>
              <h2 id={titleId} className="gdlg-t">{title}</h2>
              {subtitle && <p id={descriptionId} className="gdlg-sub">{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="gdlg-x" onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={1.85} />
          </button>
        </div>
        <div className="gdlg-b">{children}</div>
        {footer && <div className="gdlg-ft">{footer}</div>}
      </div>
    </div>
  );
}

/** ElMessageBox.confirm 的 Promise 等价（原生 confirm 保同步拦截语义） */
export function confirmBox(message: string, confirmText = "确定"): Promise<boolean> {
  return Promise.resolve(window.confirm(`${message}`));
}

/* ─── Tabs（neu-tab-bar / neu-tab 来自 web 设计系统）─── */
export function SpTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel = "内容分组",
  variant = "soft",
  semantics = "tabs",
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: {
    value: T;
    label: ReactNode;
    count?: number;
    tabId?: string;
    panelId?: string;
  }[];
  ariaLabel?: string;
  variant?: "soft" | "line";
  semantics?: "tabs" | "filter";
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const usesTabSemantics = semantics === "tabs";

  const moveFocus = (index: number) => {
    const target = tabs[index];
    if (!target) return;
    onChange(target.value);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length === 0) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    moveFocus(nextIndex);
  };

  return (
    <div
      className={cn("neu-tab-bar", variant === "line" && "sp-tabs-line")}
      role={usesTabSemantics ? "tablist" : "group"}
      aria-label={ariaLabel}
      aria-orientation={usesTabSemantics ? "horizontal" : undefined}
    >
      {tabs.map((t, index) => (
        <button
          key={t.value}
          ref={(element) => { tabRefs.current[index] = element; }}
          id={t.tabId}
          type="button"
          role={usesTabSemantics ? "tab" : undefined}
          aria-controls={usesTabSemantics ? t.panelId : undefined}
          aria-selected={usesTabSemantics ? value === t.value : undefined}
          aria-pressed={usesTabSemantics ? undefined : value === t.value}
          tabIndex={usesTabSemantics ? (value === t.value ? 0 : -1) : undefined}
          className={cn(
            "neu-tab",
            variant === "line" && "sp-tab-line",
            value === t.value && "is-active",
          )}
          onClick={() => onChange(t.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="neu-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Keeps tab ID relationships valid while mounting content for only the active data domain. */
export function SpTabPanel({
  id,
  labelledBy,
  active,
  className,
  children,
}: {
  id: string;
  labelledBy: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={className}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={!active}
    >
      {active ? children : null}
    </section>
  );
}

/* ─── 分页 ─── */
export function SpPagination({ page, pageSize, total, onChange }: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <nav className="sp-pg" aria-label="分页导航">
      <span aria-live="polite">共 {total} 条 · 第 {page}/{pages} 页</span>
      <div className="flex gap-1.5">
        <button type="button" className="neu-btn-xs" aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={13} />
        </button>
        <button type="button" className="neu-btn-xs" aria-label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={13} />
        </button>
      </div>
    </nav>
  );
}

/* ─── 进度条 ─── */
export function SpProgress({ value, tone, label = "进度" }: { value: number; tone?: "success" | "warning" | "danger"; label?: string }) {
  const normalizedValue = Math.min(100, Math.max(0, value));
  return (
    <div
      className="sp-prog"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedValue}
      aria-valuetext={`${normalizedValue}%`}
    >
      <div
        className={cn("sp-prog-fill", tone === "success" && "ok", tone === "warning" && "warn", tone === "danger" && "bad")}
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  );
}

/* ─── 空态：居中竖排；card=true 时装入模块卡片（tab 面板等整模块空场景） ─── */
export function EmptyState({ icon: Icon, title, desc, children, role = "status", card = false }: {
  icon: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  title: string;
  desc?: string;
  children?: ReactNode;
  role?: "status" | "alert";
  card?: boolean;
}) {
  const panel = (
    <div className="sp-empty-panel" role={role}>
      <div className="sp-empty-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div className="sp-empty-copy">
        <div className="sp-empty-text">{title}</div>
        {desc && <div className="sp-empty-desc">{desc}</div>}
      </div>
      {children && <div className="sp-empty-actions">{children}</div>}
    </div>
  );
  return card ? <div className="sp-module sp-empty-module">{panel}</div> : panel;
}

/* ─── 加载 / 错误块 ─── */
export function LoadingBlock({ text = "加载中…" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-sm text-[var(--fg-2)] gap-2">
      <Loader2 size={20} className="animate-spin" />
      {text}
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-lines">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="skeleton-line" style={{ width: j === 2 ? "60%" : "100%" }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── 回到顶部 ─── */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        const el = document.querySelector(".sp-content") as HTMLElement | null;
        const y = el ? el.scrollTop : window.scrollY;
        setVisible(y > 400);
        timer.current = null;
      }, 100);
    };
    // sp-content 是滚动容器；window 兜底
    const container = document.querySelector(".sp-content");
    const target: Element | Window = container || window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      className="btt-btn"
      aria-label="回到顶部"
      onClick={() => {
        const el = document.querySelector(".sp-content") as HTMLElement | null;
        if (el) el.scrollTo({ top: 0, behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M10 16V4M10 4L5 9M10 4l5 5" />
      </svg>
    </button>
  );
}
