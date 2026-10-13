import { AlertCircle, RotateCw } from "lucide-react";

/** 页顶错误横幅——保留最近数据不白屏，提供重试 */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2.5 rounded-[14px] border border-[color-mix(in_oklch,var(--danger)_25%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3.5 py-2.5">
      <AlertCircle size={15} className="shrink-0 text-[var(--danger)]" />
      <span className="min-w-0 flex-1 text-xs font-medium text-[var(--danger)]">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex h-8 shrink-0 items-center gap-1 rounded-[9px] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] bg-white/70 px-2.5 text-[11px] font-bold text-[var(--danger)] active:scale-95"
      >
        <RotateCw size={11} /> 重试
      </button>
    </div>
  );
}
