'use client';

/**
 * 上传进度行（2026-11-09 统一各处零散的「文件名 + 进度条 + 百分比」三件套）：
 * - 有 label（文件名/说明）：两行式——顶行 label 居左、百分比居右，进度条整行铺满；
 * - 无 label：单行式——进度条占满剩余宽度、百分比靠右，适配弹窗底部等紧凑位置；
 * - className 透传容器（外距、宽度等由应用位置自定）。
 */
import { WaterBar } from './water-bar';

export function UploadProgressRow({
  label,
  pct,
  state = 'uploading',
  className = '',
}: {
  label?: string;
  pct: number;
  state?: 'pending' | 'uploading' | 'done' | 'failed';
  className?: string;
}) {
  const pctText = (
    <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-[var(--accent)]">{Math.max(0, Math.min(100, Math.round(pct)))}%</span>
  );
  if (label === undefined) {
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        <div className="min-w-0 flex-1">
          <WaterBar pct={pct} state={state} />
        </div>
        {pctText}
      </div>
    );
  }
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--foreground)]" title={label}>
          {label}
        </span>
        {pctText}
      </div>
      <WaterBar pct={pct} state={state} />
    </div>
  );
}
