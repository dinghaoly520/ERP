"use client";

/**
 * 供应商门户通用 UI 原语 — Element Plus 组件的 React 等价物。
 * 样式全部来自 globals.css（web 设计系统 neu-* + sp-* 移植层 + Part4 通用层），
 * 组件本身不含内联 style（cgzxui 规范）。
 */
import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
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
export function SpSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
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
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="gdlg-ov" onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose(); }}>
      <div className="gdlg-pn" style={{ width, maxWidth: "100%" }} role="dialog" aria-modal>
        <div className="gdlg-h">
          <div className="gdlg-hl">
            {Icon && (
              <div className="gdlg-hi">
                <Icon size={20} strokeWidth={1.75} />
              </div>
            )}
            <div>
              <h2 className="gdlg-t">{title}</h2>
              {subtitle && <p className="gdlg-sub">{subtitle}</p>}
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
export function SpTabs<T extends string>({ value, onChange, tabs }: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <div className="neu-tab-bar">
      {tabs.map((t) => (
        <button key={t.value} type="button" className={cn("neu-tab", value === t.value && "is-active")} onClick={() => onChange(t.value)}>
          {t.label}
          {typeof t.count === "number" && <span className="neu-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
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
    <div className="sp-pg">
      <span>共 {total} 条 · 第 {page}/{pages} 页</span>
      <div className="flex gap-1.5">
        <button type="button" className="neu-btn-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={13} />
        </button>
        <button type="button" className="neu-btn-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

/* ─── 进度条 ─── */
export function SpProgress({ value, tone }: { value: number; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="sp-prog">
      <div
        className={cn("sp-prog-fill", tone === "success" && "ok", tone === "warning" && "warn", tone === "danger" && "bad")}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ─── 空态（统一 .sp-empty-icon 44×44 徽章 + lucide 22/1.75）─── */
export function EmptyState({ icon: Icon, title, desc, children }: {
  icon: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  title: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="sp-empty-panel">
      <div className="sp-empty-icon">
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <div className="sp-empty-text">{title}</div>
      {desc && <div className="sp-empty-desc">{desc}</div>}
      {children}
    </div>
  );
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
