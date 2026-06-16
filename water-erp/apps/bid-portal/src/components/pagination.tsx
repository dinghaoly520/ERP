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
    <div className="flex items-center justify-between px-5 py-3 border-t border-[oklch(0.94_0.004_264)]">
      <span className="text-[11px] text-[oklch(0.62_0.008_264)]">
        {start}–{end} / {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] disabled:opacity-30 transition">
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
          <button key={p} onClick={() => onPage(p)}
            className={`w-7 h-7 rounded-lg text-[11px] font-bold transition ${
              p === page ? 'bg-[#064ea2] text-white' : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)]'
            }`}>{p}</button>
        ))}
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] disabled:opacity-30 transition">
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
