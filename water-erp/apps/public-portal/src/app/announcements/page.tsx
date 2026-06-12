'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ANNOUNCEMENTS, ANNOUNCEMENT_TABS } from '@/lib/announcements';

export default function AnnouncementsPage() {
  const router = useRouter();
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');

  const filtered = ANNOUNCEMENTS.filter(a => {
    const matchType = !type || a.type === type;
    const matchSearch = !search || a.title.includes(search) || a.code.includes(search);
    return matchType && matchSearch;
  });

  return (
    <div className="min-h-screen bg-[#f7f9fc]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      {/* ═══ Header — 与首页一致 ═══ */}
      <header className="sticky top-0 z-50 h-[88px] flex items-center bg-white border-b border-[#e5ecf4]">
        <div className="w-full px-[clamp(40px,4vw,72px)] flex items-center justify-between h-full">
          <a href="/" className="flex items-center gap-3 shrink-0">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-14 w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong className="text-[#123a6e] text-3xl tracking-[0.14em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
              <small className="text-[7px] text-[#8a96aa] font-medium text-center whitespace-nowrap tracking-wide">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
            </div>
          </a>

          <button onClick={() => router.push('/')}
            className="h-10 px-5 border border-[#c5d3e8] text-[#064ea2] bg-white rounded-full text-[13px] font-semibold hover:bg-[#064ea2] hover:text-white hover:border-[#064ea2] hover:shadow-[0_2px_8px_rgba(6,78,162,.25)] active:scale-95 transition-all duration-200">
            ← 返回首页
          </button>
        </div>
      </header>

      {/* ═══ 内容区 — 全宽与首页对齐 ═══ */}
      <div className="px-[clamp(40px,4vw,72px)] py-10">
        {/* 标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-black text-[#18243a] mb-1" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>信息公告</h1>
          <p className="text-sm text-[#8a96aa]">招标公告 · 中标公示 · 政策法规 · 平台通知</p>
        </div>

        {/* Tab 切换 + 搜索 */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex gap-2">
            {ANNOUNCEMENT_TABS.map(tab => (
              <button key={tab.key} onClick={() => setType(tab.key)}
                className={`px-4 py-2 text-[13px] font-semibold rounded-full transition-all duration-200 cursor-pointer min-h-[36px] ${
                  tab.key === type
                    ? 'text-white'
                    : 'text-[#5a6d8a] bg-[#e8ecf2] hover:bg-[#dde3ed]'
                }`}
                style={tab.key === type ? { backgroundColor: tab.color || '#064ea2' } : undefined}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索公告标题..."
              className="w-64 h-9 pl-9 pr-3 bg-white border border-[#d0dae8] rounded-full text-sm focus:outline-none focus:border-[#064ea2] placeholder:text-[#bbb]" />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#bbb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        {/* 列表 */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-16 text-center">
            <div className="text-5xl mb-4">📢</div>
            <p className="text-[#5a6d8a] font-semibold mb-1">暂无相关公告</p>
            <p className="text-xs text-[#8a96aa]">试试切换分类或调整搜索关键词</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(a => (
              <div key={a.id} onClick={() => router.push(`/announcements/${a.id}`)}
                className="bg-white rounded-2xl border border-[#e5ecf4] p-5 hover:border-[#064ea240] hover:shadow-md transition-all cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ color: a.color, backgroundColor: a.color + '18' }}>{a.tag}</span>
                  {a.urgent && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded-full font-bold">重要</span>}
                  <span className="text-[15px] font-bold text-[#18243a] flex-1">{a.title}</span>
                </div>
                <p className="text-xs text-[#5a6d8a] ml-1 mb-2 line-clamp-2">{a.desc}</p>
                <div className="flex items-center gap-4 text-xs text-[#8a96aa] ml-1">
                  <span>{a.date}</span>
                  <span>编号：{a.code}</span>
                  <span>{a.deadlineLabel}：{a.deadline}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
