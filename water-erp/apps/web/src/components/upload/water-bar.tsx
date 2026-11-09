'use client';

/**
 * 上传进度条（2026-11-09 白瓷重设计）：内凹轨道 + 纯白瓷片填充（顶内高光 + 底缘微影，
 * 与系统瓷片语言一致）。uploading 瓷片上保留水面波纹与流光；done 为 success 淡染瓷片
 * 加一次性涟漪；failed 为 danger 淡染；pending 为 accent 微染静态。
 * 动效全部 CSS（globals.css .up-*）。
 */
export function WaterBar({
  pct,
  state,
  showRipple,
}: {
  pct: number;
  state: 'pending' | 'uploading' | 'done' | 'failed';
  /** done 时的一次性完成涟漪（元素首次挂载播放一次，forwards 定定格透明） */
  showRipple?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const fillCls =
    state === 'done'
      ? 'up-fill up-fill--done'
      : state === 'failed'
        ? 'up-fill up-fill--failed'
        : state === 'pending'
          ? 'up-fill up-fill--pending'
          : 'up-fill';
  return (
    <div
      className="up-track relative h-2.5 w-full overflow-hidden rounded-full"
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
