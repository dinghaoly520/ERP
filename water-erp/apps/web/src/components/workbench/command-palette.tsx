'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

interface CommandItem { label: string; path: string; keywords?: string; }

const COMMANDS: CommandItem[] = [
  { label: '首页驾驶舱', path: '/dashboard', keywords: 'dashboard 首页 驾驶舱' },
  { label: '信息发布中心', path: '/notice', keywords: 'notice 公告 公示 信息发布' },
  { label: '供应商审批', path: '/supplier/approval', keywords: '审批 待审 供应商' },
  { label: '供应商库', path: '/supplier/repository', keywords: '库 供应商 列表' },
  { label: '供应商选取', path: '/supplier/selection', keywords: '选取 智能 推荐 AI' },
  { label: '供应商评价', path: '/supplier/evaluation', keywords: '评价 履约 打分' },
  { label: '专家录入', path: '/expert/entry', keywords: '录入 添加 专家' },
  { label: '专家库', path: '/expert/repository', keywords: '专家 列表 库' },
  { label: '专家抽取', path: '/expert/extract', keywords: '抽取 智能 组建 评审组' },
  { label: '专家评价', path: '/expert/evaluation', keywords: '评价 履职 专家' },
  { label: '价格审批', path: '/mall-management/catalog?tab=approval', keywords: '审批 价格 报价 商城' },
  { label: '价格录入', path: '/mall-management/catalog?tab=entry', keywords: '录入 导入 新增 目录 商城' },
  { label: '集中采购目录', path: '/mall-management/catalog', keywords: '目录 采购 品类' },
  { label: '操作日志', path: '/mall-management/catalog?tab=logs', keywords: '日志 审计 同步' },
  { label: '通知中心', path: '/notifications', keywords: '通知 待办 消息' },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = COMMANDS.filter(c =>
    !query || c.label.includes(query) || c.keywords?.includes(query),
  );

  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(true); }
    if (e.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  useEffect(() => {
    if (open) { inputRef.current?.focus(); setQuery(''); setIdx(0); }
  }, [open]);

  const handleNav = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[idx]) { router.push(filtered[idx].path); setOpen(false); }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop fixed inset-0 z-[60] flex items-start justify-center bg-black/25 pt-[20vh]" onClick={() => setOpen(false)}>
      <div className="modal-content w-full max-w-lg rounded-2xl border border-[#e5ecf4] bg-white shadow-[0_24px_60px_rgba(15,47,87,0.20)] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#eef3f8] px-4 py-3">
          <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setIdx(0); }}
            onKeyDown={handleNav}
            placeholder="搜索页面..."
            className="flex-1 bg-transparent text-sm font-semibold text-[#18243a] placeholder-[#94a3b8] outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center rounded-lg border border-[#e5ecf4] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-semibold text-[#8a99ad]">esc</kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[#8a99ad]">无匹配页面</div>
          ) : filtered.map((c, i) => (
            <button
              key={c.path}
              onClick={() => { router.push(c.path); setOpen(false); }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition ${i === idx ? 'bg-[#eff6ff] text-[#064ea2]' : 'text-[#18243a] hover:bg-[#f8fafc]'}`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-extrabold ${i === idx ? 'bg-[#064ea2] text-white' : 'bg-[#f1f5f9] text-[#5a6d8a]'}`}>
                {i < 9 ? i + 1 : '⌘'}
              </span>
              {c.label}
            </button>
          ))}
        </div>
        <div className="border-t border-[#eef3f8] px-4 py-2 text-xs text-[#8a99ad]">
          <kbd className="inline-flex items-center rounded border border-[#e5ecf4] bg-[#f8fafc] px-1.5 py-0.5 text-[10px] font-semibold">⌘K</kbd> 打开 &nbsp; <kbd className="inline-flex items-center rounded border border-[#e5ecf4] bg-[#f8fafc] px-1.5 py-0.5 text-[10px] font-semibold">↑↓</kbd> 导航 &nbsp; <kbd className="inline-flex items-center rounded border border-[#e5ecf4] bg-[#f8fafc] px-1.5 py-0.5 text-[10px] font-semibold">⏎</kbd> 跳转 &nbsp; <kbd className="inline-flex items-center rounded border border-[#e5ecf4] bg-[#f8fafc] px-1.5 py-0.5 text-[10px] font-semibold">esc</kbd> 关闭
        </div>
      </div>
    </div>
  );
}
