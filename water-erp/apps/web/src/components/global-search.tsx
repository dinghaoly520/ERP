'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Building2, FileText, User, Package } from 'lucide-react';
import { globalSearch } from '@/lib/api/supplier';
import type { SearchResult } from '@/lib/api/supplier';

const TYPE_ICONS: Record<string, typeof Building2> = { supplier: Building2, project: FileText, expert: User, procurement: Package };
const TYPE_LABELS: Record<string, string> = { supplier: '供应商', project: '项目', expert: '专家', procurement: '采购' };

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try { const res = await globalSearch(q); setResults(res.results); } catch { setResults([]); }
    setLoading(false);
    setActiveIdx(0);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(true); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else { setQuery(''); setResults([]); }
  }, [open]);

  const go = (r: SearchResult) => { router.push(r.link); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[activeIdx]) { go(results[activeIdx]); }
  };

  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) { (grouped[r.type] = grouped[r.type] || []).push(r); }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-[rgba(242,246,255,0.55)] backdrop-blur-md" />
      <div className="relative z-10 w-full max-w-[min(580px,92vw)] rounded-[20px] bg-[var(--background)] shadow-[0_24px_72px_oklch(0.24_0.038_258/0.14)] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[oklch(0.6_0.04_258/0.12)]">
          {loading ? <Loader2 size={16} className="animate-spin text-[var(--muted-foreground)]" /> : <Search size={16} className="text-[var(--muted-foreground)]" />}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索供应商、项目、专家、采购..."
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/60 outline-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded bg-[var(--muted)]/40 px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]/60">⌘K</kbd>
        </div>
        {results.length === 0 && query.length >= 2 && !loading && (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">未找到匹配结果</div>
        )}
        {query.length < 2 && !loading && (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]/50">输入至少 2 个字符开始搜索</div>
        )}
        {Object.keys(grouped).map(type => (
          <div key={type}>
            <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]/60">{TYPE_LABELS[type] || type}</div>
            {grouped[type].map((r, i) => {
              const Icon = TYPE_ICONS[type] || Building2;
              const absIdx = results.indexOf(r);
              return (
                <button
                  key={r.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--accent)]/6 transition ${absIdx === activeIdx ? 'bg-[var(--accent)]/10' : ''}`}
                  onClick={() => go(r)}
                >
                  <Icon size={15} className="text-[var(--muted-foreground)]/60 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--foreground)] truncate">{r.title}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]/70 truncate">{r.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
