'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';

const ANNOUNCEMENT_TYPE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  BID_NOTICE: { label: '招标公告', color: '#064ea2', bg: '#064ea218' },
  WIN_NOTICE: { label: '中标公示', color: '#18a56c', bg: '#18a56c18' },
  POLICY: { label: '政策法规', color: '#f5a623', bg: '#f5a62318' },
  PLATFORM: { label: '平台通知', color: '#5a6d8a', bg: '#5a6d8a18' },
};

export default function AnnouncementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [item, setItem] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Announcement>(`/announcements/public/${id}`)
      .then(setItem)
      .catch(() => router.push('/announcements'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-[#f7f9fc] flex items-center justify-center text-[#8a96aa]">加载中...</div>
  );
  if (!item) return null;

  const t = ANNOUNCEMENT_TYPE_MAP[item.type] || ANNOUNCEMENT_TYPE_MAP.PLATFORM;

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

          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/announcements')}
              className="h-10 px-5 text-[13px] font-semibold transition-all duration-200 active:scale-95"
              style={{ background: '#fff', color: '#5a6d8a', border: '1px solid #d0dae8', borderRadius: 2 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#064ea2'; e.currentTarget.style.color = '#064ea2'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d0dae8'; e.currentTarget.style.color = '#5a6d8a'; }}>
              ← 公告列表
            </button>
            <button onClick={() => router.push('/')}
              className="h-10 px-5 text-[13px] font-semibold transition-all duration-200 active:scale-95"
              style={{ background: '#fff', color: '#064ea2', border: '1px solid #c5d3e8', borderRadius: 2 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#064ea2'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#064ea2'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#064ea2'; e.currentTarget.style.borderColor = '#c5d3e8'; }}>
              ← 返回首页
            </button>
          </div>
        </div>
      </header>

      {/* ═══ 内容区 ═══ */}
      <div className="px-[clamp(40px,4vw,72px)] py-10">
        <div className="max-w-[960px]">
          <div className="bg-white border border-[#e5ecf4] p-8" style={{ borderRadius: 2 }}>
            {/* 标签 */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs px-3 py-1 rounded font-semibold" style={{ color: t.color, backgroundColor: t.bg }}>{t.label}</span>
              {item.isTop && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded font-bold">置顶</span>}
            </div>

            {/* 标题 */}
            <h1 className="text-2xl font-black text-[#18243a] mb-4 leading-snug" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>{item.title}</h1>

            {/* 元信息 */}
            <div className="flex items-center gap-5 text-sm text-[#8a96aa] mb-6 pb-6" style={{ borderBottom: '1px solid #e5ecf4' }}>
              <span>发布时间：{item.publishDate ? new Date(item.publishDate).toLocaleString('zh-CN') : ''}</span>
              {item.relatedProjectCode && <span>项目编号：{item.relatedProjectCode}</span>}
              <span>浏览 {item.viewCount || 0} 次</span>
            </div>

            {/* 摘要 */}
            {item.summary && (
              <div className="p-4 mb-6 text-sm text-[#5a6d8a] border border-[#e5ecf4]" style={{ background: '#f7f9fc', borderRadius: 2 }}>
                <strong className="text-[#18243a]">摘要：</strong>{item.summary}
              </div>
            )}

            {/* 正文 */}
            <div className="text-[15px] text-[#18243a] leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: item.content || '' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
