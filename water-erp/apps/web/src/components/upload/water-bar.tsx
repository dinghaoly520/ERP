'use client';

/**
 * 水波进度条（spec §4.2/§4.3）：h-1.5 细条，轨道内凹 hairline；
 * uploading=accent 半透明填充+水面波纹（两层错相）+流光扫过；done=success（一次性涟漪）；
 * failed=danger；pending=accent-soft 静态。动效全部 CSS（globals.css .up-*），零 JS 动画。
 */
export function WaterBar({
  pct,
  state,
  showRipple,
}: {
  pct: number;
  state: 'pending' | 'uploading' | 'done' | 'failed';
  /** done 时的一次性完成涟漪（元素首次挂载播放一次，forwards 定格透明） */
  showRipple?: boolean;
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
        {showRipple && state === 'done' && <span className="up-ripple" aria-hidden="true" />}
      </div>
    </div>
  );
}
