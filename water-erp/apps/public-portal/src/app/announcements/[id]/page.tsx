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
    <div className="min-h-screen bg-[oklch(0.982_0.003_264)] flex items-center justify-center text-[oklch(0.55_0.01_264)]">加载中...</div>
  );
  if (!item) return null;

  const t = ANNOUNCEMENT_TYPE_MAP[item.type] || ANNOUNCEMENT_TYPE_MAP.PLATFORM;

  return (
    <div className="min-h-screen bg-[oklch(0.982_0.003_264)]">
      <header className="bg-white shadow-sm border-b border-[oklch(0.91_0.006_264)]">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/announcements" className="text-sm text-[oklch(0.55_0.01_264)] hover:text-[#064ea2] font-semibold transition">← 返回公告列表</a>
          <span className="text-xs text-[oklch(0.55_0.01_264)]">浏览 {item.viewCount} 次</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-[oklch(0.91_0.006_264)] p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ color: t.color, backgroundColor: t.color + '18' }}>{t.label}</span>
            {item.isTop && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded font-bold">置顶</span>}
          </div>
          <h1 className="text-2xl font-extrabold text-[oklch(0.18_0.012_265)] mb-4 leading-snug">{item.title}</h1>
          <div className="flex items-center gap-4 text-sm text-[oklch(0.72_0.008_264)] mb-6 pb-6 border-b border-[oklch(0.91_0.006_264)]">
            <span>发布时间：{item.publishDate ? new Date(item.publishDate).toLocaleString('zh-CN') : ''}</span>
            {item.relatedProjectCode && <span>关联项目：{item.relatedProjectCode}</span>}
          </div>
          {item.summary && (
            <div className="bg-[oklch(0.992_0.003_264)] rounded-xl p-4 mb-6 text-sm text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)]">
              <strong className="text-[oklch(0.18_0.012_265)]">摘要：</strong>{item.summary}
            </div>
          )}
          <div className="text-[15px] text-[oklch(0.18_0.012_265)] leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: item.content || '' }} />
        </div>
      </div>
    </div>
  );
}
