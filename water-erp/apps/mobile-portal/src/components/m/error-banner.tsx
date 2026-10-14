import { AlertCircle, RotateCw } from "lucide-react";

/** 页顶错误横幅——wb-alert 语言（color-mix 色调底、无边框），保留最近数据不白屏，提供重试 */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2.5 rounded-[14px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3.5 py-2.5">
      <AlertCircle size={15} className="shrink-0 text-[var(--danger)]" />
      <span className="min-w-0 flex-1 text-xs font-medium text-[var(--danger)]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="neu-btn-soft is-danger h-8 shrink-0 rounded-[9px] px-2.5 text-[11px] active:scale-95"
      >
        <RotateCw size={11} /> 重试
      </button>
    </div>
  );
}
