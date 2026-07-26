const BAR = 'bg-[oklch(0.92_0.012_258)]';
const BAR_SOFT = 'bg-[oklch(0.95_0.01_258)]';
// 确定性宽度类（避免内联 style width）
const WIDTHS = ['w-[55%]', 'w-[70%]', 'w-[82%]', 'w-[64%]'];

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <table className="neu-table is-dense w-full">
      <thead>
        <tr className="text-left text-[color:var(--muted-foreground)]">
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i} className="px-5 py-3">
              <div className={`h-3 w-16 rounded ${BAR} animate-pulse`} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c} className="px-5 py-3">
                <div className={`h-3 rounded ${BAR_SOFT} animate-pulse ${WIDTHS[(r * cols + c) % WIDTHS.length]}`} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="neu-card-static p-5">
          <div className={`mb-2 h-3 w-12 rounded ${BAR} animate-pulse`} />
          <div className={`h-8 w-16 rounded ${BAR_SOFT} animate-pulse`} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className={`h-7 w-48 rounded ${BAR}`} />
      <div className={`h-4 w-80 rounded ${BAR_SOFT}`} />
      <CardSkeleton />
      <div className="neu-card-static p-5">
        <TableSkeleton />
      </div>
    </div>
  );
}
