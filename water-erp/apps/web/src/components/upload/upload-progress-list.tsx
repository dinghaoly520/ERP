'use client';

/**
 * 每文件上传行（spec §4.2）：状态图标 + 文件名(truncate) + 大小(font-mono) + 状态/百分比
 * + [重试]（failed/canceled），行下 WaterBar。状态机与 useFileUploads 的 UploadItem 对齐。
 */
import { AlertCircle, CheckCircle2, Circle, Loader2, RotateCcw } from 'lucide-react';
import type { UploadItem } from '@/lib/upload/use-file-uploads';
import { formatBytes } from '@/lib/upload/format';
import { WaterBar } from './water-bar';

export function UploadProgressList<T>({
  items,
  onRetry,
  retryDisabled,
}: {
  items: UploadItem<T>[];
  onRetry?: (id: string) => void;
  retryDisabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map(it => {
        const pct = it.total > 0 ? Math.round((it.loaded / it.total) * 100) : 0;
        const barState = it.status === 'canceled' ? 'pending' : it.status;
        return (
          <div key={it.id} className="rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              {it.status === 'uploading' ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-[var(--accent)]" />
              ) : it.status === 'done' ? (
                <CheckCircle2 size={13} className="shrink-0 text-[var(--success)]" />
              ) : it.status === 'failed' ? (
                <AlertCircle size={13} className="shrink-0 text-[var(--danger)]" />
              ) : (
                <Circle size={13} className="shrink-0 text-[var(--muted-foreground)]/50" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]" title={it.file.name}>
                {it.file.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                {formatBytes(it.file.size)}
              </span>
              {it.status === 'uploading' ? (
                <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-[var(--accent)]">{pct}%</span>
              ) : it.status === 'done' ? (
                <span className="shrink-0 text-[11px] font-semibold text-[var(--success)]">已完成</span>
              ) : it.status === 'failed' ? (
                <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                  <span className="max-w-[180px] truncate text-[11px] font-semibold text-[var(--danger)]" title={it.error}>
                    {it.error ?? '上传失败'}
                  </span>
                  {onRetry && (
                    <button
                      type="button"
                      className="neu-btn-xs !px-2 !py-1 !text-[10px]"
                      disabled={retryDisabled}
                      onClick={() => onRetry(it.id)}
                    >
                      <RotateCcw size={10} /> 重试
                    </button>
                  )}
                </span>
              ) : it.status === 'canceled' ? (
                onRetry ? (
                  <button
                    type="button"
                    className="neu-btn-xs shrink-0 !px-2 !py-1 !text-[10px]"
                    disabled={retryDisabled}
                    onClick={() => onRetry(it.id)}
                  >
                    <RotateCcw size={10} /> 重试
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] font-semibold text-[var(--muted-foreground)]">已取消</span>
                )
              ) : (
                <span className="shrink-0 text-[11px] font-semibold text-[var(--muted-foreground)]">等待中</span>
              )}
            </div>
            <div className="mt-2">
              <WaterBar pct={it.status === 'done' ? 100 : pct} state={barState} showRipple={it.status === 'done'} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
