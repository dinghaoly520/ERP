'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchPublicAnnouncement, ANNOUNCEMENTS, type AnnouncementItem } from '@/lib/announcements';

export default function AnnouncementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [item, setItem] = useState<AnnouncementItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPublicAnnouncement(id)
      .then(data => { if (!cancelled) setItem(data); })
      .catch(() => {
        // Fallback to local data
        if (!cancelled) {
          const found = ANNOUNCEMENTS.find(a => a.id === id) || null;
          setItem(found);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-[#f7f9fc] flex flex-col items-center justify-center gap-4" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="text-5xl">⏳</div>
      <p className="text-[#5a6d8a] font-semibold">正在加载公告...</p>
    </div>
  );

  if (!item) return (
    <div className="min-h-screen bg-[#f7f9fc] flex flex-col items-center justify-center gap-4" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="text-5xl">📢</div>
      <p className="text-[#5a6d8a] font-semibold">未找到该公告</p>
      <button onClick={() => router.push('/announcements')}
        className="h-11 px-6 bg-[#064ea2] text-white rounded-full text-sm font-semibold hover:bg-[#084fb0] hover:shadow-[0_2px_12px_rgba(6,78,162,.35)] active:scale-95 transition-all duration-200">
        返回公告列表
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f7f9fc]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      {/* ═══ Header — 与首页一致 ═══ */}
      <header className="sticky top-0 z-50 h-[88px] flex items-center bg-white border-b border-[#e5ecf4]">
        <div className="w-full px-[clamp(40px,4vw,72px)] flex items-center justify-between h-full">
          <a href="/" className="flex items-center gap-3 shrink-0">
            <img src="/assets/logo.png" alt="四川水发集团" className="h-14 w-auto object-contain" />
            <div className="flex flex-col gap-0">
              <strong className="text-[#123a6e] text-3xl tracking-[0.14em] leading-tight whitespace-nowrap" style={{ fontFamily: '"SimHei","黑体",sans-serif', fontWeight: 900 }}>四川水发集团</strong>
              <small className="text-[7px] text-[#8a96aa] font-medium text-center whitespace-nowrap tracking-wide">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
            </div>
          </a>

          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/announcements')}
              className="h-11 px-6 border border-[#c5d3e8] text-[#064ea2] bg-white rounded-full text-sm font-semibold hover:bg-[#064ea2] hover:text-white hover:border-[#064ea2] hover:shadow-[0_2px_8px_rgba(6,78,162,.25)] active:scale-95 transition-all duration-200">
              公告列表
            </button>
            <button onClick={() => router.push('/')}
              className="h-11 px-6 bg-[#064ea2] text-white rounded-full text-sm font-semibold hover:bg-[#084fb0] hover:shadow-[0_2px_12px_rgba(6,78,162,.35)] active:scale-95 transition-all duration-200">
              返回首页
            </button>
          </div>
        </div>
      </header>

      {/* ═══ 内容区 ═══ */}
      <div className="px-[clamp(40px,4vw,72px)] py-10">
        <div className="w-full mx-auto">
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-8">
            {/* 标签 */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs px-3 py-1 rounded-full font-semibold" style={{ color: item.color, backgroundColor: item.color + '18' }}>{item.tag}</span>
              {item.urgent && <span className="text-xs bg-[#fff1f0] text-[#d43030] px-2 py-0.5 rounded-full font-bold">重要</span>}
            </div>

            {/* 标题 */}
            <h1 className="text-2xl font-black text-[#18243a] mb-4 leading-snug" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>{item.title}</h1>

            {/* 元信息 */}
            <div className="flex items-center gap-5 text-sm text-[#8a96aa] mb-6 pb-6 border-b border-[#e5ecf4]">
              <span>发布时间：{item.date}</span>
              {item.code && <span>编号：{item.code}</span>}
            </div>

            {/* AI 摘要 */}
            {item.aiSummary && (
              <div className="mb-6 rounded-xl border border-[#d8e6f7] bg-[#f6fbff] p-5">
                <div className="mb-2 text-sm font-bold text-[#064ea2]">AI 摘要</div>
                <p className="text-[15px] leading-8 text-[#26364e]">{item.aiSummary}</p>
              </div>
            )}

            {/* 正文 */}
            <div
              className="announcement-detail-content text-[15px] text-[#18243a] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: item.content }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
