'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (p: number) => void;
}

export function Pagination({ page, totalPages, totalItems, pageSize, onPage }: Props) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="tabular-nums text-[11px] text-[color:var(--muted-foreground)]">
        {start}–{end} / {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-[10px] p-1.5 text-[color:var(--muted-foreground)] transition hover:bg-[oklch(0.985_0.006_258_/_0.7)] hover:text-[color:var(--foreground)] disabled:opacity-30"
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={`flex h-7 w-7 items-center justify-center rounded-[10px] text-[11px] font-bold transition ${
              p === page
                ? 'bg-[var(--accent)] text-white shadow-[0_4px_12px_rgba(6,78,162,0.25)]'
                : 'text-[color:var(--muted-foreground)] hover:bg-[oklch(0.985_0.006_258_/_0.7)]'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-[10px] p-1.5 text-[color:var(--muted-foreground)] transition hover:bg-[oklch(0.985_0.006_258_/_0.7)] hover:text-[color:var(--foreground)] disabled:opacity-30"
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
