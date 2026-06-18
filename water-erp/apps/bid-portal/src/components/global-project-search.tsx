'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Search, ChevronDown, Loader2 } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

interface SlimProject {
  id: string;
  projectCode: string;
  name: string;
  stage: string;
}

// 全局选择器的阶段过滤：仅 ≥ OPENING
const VISIBLE_STAGES = ['OPENING', 'EVALUATING', 'ARCHIVED'];

export default function GlobalProjectSearch() {
  const router = useRouter();
  const [projects, setProjects] = useState<SlimProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取项目列表（仅 OPENING+）
  useEffect(() => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    VISIBLE_STAGES.forEach(s => params.append('stage[]', s));
    api.get<SlimProject[]>(`/bid/projects?${params.toString()}`)
      .then(ps => { setProjects(ps); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // 前端搜索过滤
  const filtered = query.trim()
    ? projects.filter(p =>
        p.projectCode.toLowerCase().includes(query.toLowerCase()) ||
        p.name.toLowerCase().includes(query.toLowerCase())
      )
    : projects;

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && filtered[highlightIdx]) {
      e.preventDefault();
      selectProject(filtered[highlightIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const selectProject = useCallback((p: SlimProject) => {
    setOpen(false);
    setQuery('');
    setHighlightIdx(-1);
    router.push(`/bid/project/${p.id}`);
  }, [router]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative px-2 pt-3 pb-1">
      <div className="relative">
        <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="搜索项目编号或名称…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setHighlightIdx(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full rounded-xl border border-[#e5ecf4] bg-white py-2.5 pl-9 pr-8 text-xs font-medium text-[#18243a] placeholder:text-[#94a3b8] focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2]/15 transition"
        />
        <button
          onClick={() => setOpen(!open)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#94a3b8] hover:text-[#18243a] transition"
        >
          <ChevronDown size={14} strokeWidth={1.5} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute left-2 right-2 top-full mt-1 z-50 max-h-[320px] overflow-y-auto rounded-xl border border-[#dbe6f3] bg-white shadow-[0_18px_60px_rgba(15,47,87,0.14)] backdrop-blur">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-[#8a96aa] justify-center">
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
              加载项目列表…
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[#e74c3c] mb-2">加载失败</p>
              <button
                onClick={() => {
                  setLoading(true); setError(false);
                  const params = new URLSearchParams();
                  VISIBLE_STAGES.forEach(s => params.append('stage[]', s));
                  api.get<SlimProject[]>(`/bid/projects?${params.toString()}`)
                    .then(ps => { setProjects(ps); })
                    .catch(() => setError(true))
                    .finally(() => setLoading(false));
                }}
                className="text-[10px] font-bold text-[#064ea2] hover:underline"
              >
                点击重试
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#8a96aa]">
              {query.trim() ? '未找到匹配项目' : '暂无可操作的项目'}
            </div>
          ) : (
            filtered.map((p, idx) => {
              const stageLabel = STAGE_LABEL[p.stage] || p.stage;
              const stageColor = STAGE_COLOR[p.stage] || '#94a3b8';
              return (
                <button
                  key={p.id}
                  onClick={() => selectProject(p)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    idx === highlightIdx ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-[#064ea2] truncate">
                      {p.projectCode}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold whitespace-nowrap flex-shrink-0"
                      style={{ color: stageColor, backgroundColor: `${stageColor}15` }}
                    >
                      {stageLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#5a6d8a] truncate mt-0.5">{p.name}</div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
