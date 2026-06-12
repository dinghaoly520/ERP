'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Announcement } from '@/lib/types';

const ANNOUNCEMENT_TYPE_MAP: Record<string, { label: string; color: string }> = {
  BID_NOTICE: { label: '招标公告', color: '#064ea2' },
  WIN_NOTICE: { label: '中标公示', color: '#11a874' },
  POLICY: { label: '政策法规', color: '#f5a623' },
  PLATFORM: { label: '平台通知', color: '#5a6d8a' },
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
    <div className="min-h-screen bg-[#f7f9fc] flex items-center justify-center text-[#5a6d8a]">加载中...</div>
  );
  if (!item) return null;

  const t = ANNOUNCEMENT_TYPE_MAP[item.type] || ANNOUNCEMENT_TYPE_MAP.PLATFORM;

  return (
    <div className="min-h-screen bg-[#f7f9fc]">
      {/* ═══ Header with brand ═══ */}
      <header className="sticky top-0 z-50 bg-white border-b border-[#e5ecf4]">
        <div className="max-w-3xl mx-auto px-6 h-[72px] flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-11 w-auto rounded-lg object-contain" />
            <div className="flex flex-col gap-0">
              <strong className="text-[#123a6e] text-lg tracking-[0.12em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
              <small className="text-[7px] text-[#8a96aa] font-medium tracking-wide">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
            </div>
          </a>
          <a href="/announcements" className="text-sm text-[#5a6d8a] hover:text-[#064ea2] font-semibold transition">← 返回公告列表</a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl border border-[#e5ecf4] p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs px-3 py-1 rounded font-semibold" style={{ color: t.color, backgroundColor: t.color + '18' }}>{t.label}</span>
            {item.isTop && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded font-bold">置顶</span>}
          </div>
          <h1 className="text-2xl font-extrabold text-[#18243a] mb-4 leading-snug">{item.title}</h1>
          <div className="flex items-center gap-4 text-sm text-[#8a96aa] mb-6 pb-6 border-b border-[#e5ecf4]">
            <span>发布时间：{item.publishDate ? new Date(item.publishDate).toLocaleString('zh-CN') : ''}</span>
            {item.relatedProjectCode && <span>关联项目：{item.relatedProjectCode}</span>}
            <span>浏览 {item.viewCount} 次</span>
          </div>
          {item.summary && (
            <div className="bg-[#f7f9fc] rounded-xl p-4 mb-6 text-sm text-[#5a6d8a] border border-[#e5ecf4]">
              <strong className="text-[#18243a]">摘要：</strong>{item.summary}
            </div>
          )}
          <div className="text-[15px] text-[#18243a] leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: item.content || '' }} />
        </div>
      </div>
    </div>
  );
}
