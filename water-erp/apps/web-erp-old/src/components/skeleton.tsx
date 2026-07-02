export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]">
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i} className="px-5 py-3">
              <div className="h-3 bg-[#e8f0fa] rounded w-16 animate-pulse" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r} className="border-b border-[#e8f0fa]">
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c} className="px-5 py-3">
                <div className="h-3 bg-[#f0f4f8] rounded animate-pulse" style={{ width: `${65 + ((r * cols + c) * 17) % 30}%` }} />
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
        <div key={i} className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <div className="h-3 bg-[#e8f0fa] rounded w-12 mb-2 animate-pulse" />
          <div className="h-8 bg-[#f0f4f8] rounded w-16 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-7 bg-[#e8f0fa] rounded w-48" />
      <div className="h-4 bg-[#f0f4f8] rounded w-80" />
      <CardSkeleton />
      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <TableSkeleton />
      </div>
    </div>
  );
}
