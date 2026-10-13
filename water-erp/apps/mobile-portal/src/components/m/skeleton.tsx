/** 首屏加载骨架——脉冲占位块 */
export function Skeleton({ lines = 3, height = 44 }: { lines?: number; height?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[12px] bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]"
          style={{ height }}
        />
      ))}
    </div>
  );
}
