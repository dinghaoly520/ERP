'use client';
import { useState, useMemo } from 'react';

export type SortDir = 'asc' | 'desc';

export function useSort<T>(defaultKey: string, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggle = (key: string) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = (items: T[]) =>
    useMemo(() => {
      if (!items.length) return items;
      return [...items].sort((a, b) => {
        const va = (a as any)[sortKey] ?? '';
        const vb = (b as any)[sortKey] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
        if (va instanceof Date && vb instanceof Date) return sortDir === 'asc' ? va.getTime() - vb.getTime() : vb.getTime() - va.getTime();
        const sa = String(va).toLowerCase();
        const sb = String(vb).toLowerCase();
        return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
    }, [items, sortKey, sortDir]);

  return { sortKey, sortDir, toggle, sorted };
}

/** Renders sort arrows in a th. */
export function SortableTh({ label, field, sortKey, sortDir, onToggle }: {
  label: string; field: string; sortKey: string; sortDir: SortDir; onToggle: (f: string) => void;
}) {
  const active = sortKey === field;
  return (
    <th className="px-4 py-3 sortable text-center cursor-pointer select-none hover:text-[#064ea2] transition" onClick={() => onToggle(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-[10px] leading-none">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );
}
