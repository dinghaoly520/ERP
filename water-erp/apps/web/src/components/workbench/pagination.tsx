'use client';
import { useState } from 'react';

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (ps: number) => void;
  pageSizes?: number[];
}

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange, pageSizes = [10, 20, 50] }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const [jump, setJump] = useState('');

  const pages = getVisiblePages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf2f7] px-4 py-3">
      <div className="flex items-center gap-3 text-xs text-[#8a99ad]">
        <span>共 <strong className="tabular-nums text-[#18243a]">{total}</strong> 条</span>
        <span className="hidden sm:inline">|</span>
        <label className="hidden sm:flex items-center gap-1">
          每页
          <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}
            className="rounded-lg border border-[#dce6f3] bg-white px-2 py-1 text-xs font-semibold outline-none focus:border-[#064ea2]">
            {pageSizes.map(n => <option key={n} value={n}>{n} 条</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1.5">
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-[#dce6f3] px-2.5 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-30 transition">←</button>
        {pages.map((p, i) =>
          p === -1 ? <span key={`gap-${i}`} className="px-1 text-[#b8c7dc]">…</span> :
          <button key={p} onClick={() => onPageChange(p)}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold tabular-nums transition ${
              p === page ? 'bg-[#064ea2] text-white shadow-sm' : 'text-[#5a6d8a] hover:bg-[#f8fafc]'
            }`}>{p}</button>
        )}
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-[#dce6f3] px-2.5 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-30 transition">→</button>
        {totalPages > 7 && (
          <div className="hidden sm:flex items-center gap-1 ml-2">
            <input value={jump} onChange={e => setJump(e.target.value)} placeholder="跳页"
              className="w-14 rounded-lg border border-[#dce6f3] px-2 py-1 text-xs font-semibold outline-none focus:border-[#064ea2] text-center"
              onKeyDown={e => { if (e.key === 'Enter') { const n = parseInt(jump); if (n >= 1 && n <= totalPages) { onPageChange(n); setJump(''); } } }} />
          </div>
        )}
      </div>
    </div>
  );
}

function getVisiblePages(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 4, -1, total];
  if (current >= total - 2) return [1, -1, total - 3, total - 2, total - 1, total];
  return [1, -1, current - 1, current, current + 1, -1, total];
}
