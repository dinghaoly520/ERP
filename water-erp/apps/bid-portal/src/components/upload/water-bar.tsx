'use client';

/**
 * 水波进度条（2026-11-06 上传进度条，与 web 门户同款——按「无共享组件包」惯例门户自包含）：
 * h-1.5 细条；uploading=accent 半透明填充+水面波纹（两层错相）+流光扫过；done=success；
 * failed=danger；pending=accent-soft 静态。动效全部 CSS（globals.css .up-*）。
 */
export function WaterBar({
  pct,
  state,
}: {
  pct: number;
  state: 'pending' | 'uploading' | 'done' | 'failed';
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const fillCls =
    state === 'done'
      ? 'bg-[color-mix(in_oklch,var(--success)_28%,transparent)]'
      : state === 'failed'
        ? 'bg-[color-mix(in_oklch,var(--danger)_30%,transparent)]'
        : state === 'pending'
          ? 'bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]'
          : 'bg-[color-mix(in_oklch,var(--accent)_14%,transparent)]';
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_15%,transparent)]"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`relative h-full overflow-hidden rounded-full transition-[width] duration-200 ${fillCls}`} style={{ width: `${clamped}%` }}>
        {state === 'uploading' && (
          <>
            <span className="up-wave up-wave--a" aria-hidden="true" />
            <span className="up-wave up-wave--b" aria-hidden="true" />
            <span className="up-shimmer" aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  );
}
