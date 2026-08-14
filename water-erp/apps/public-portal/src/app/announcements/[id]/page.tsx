'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { fetchPublicAnnouncement, ANNOUNCEMENTS, type AnnouncementItem } from '@/lib/announcements';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

export default function AnnouncementDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const searchParams = useSearchParams();
  // 从首页打开时返回首页，否则返回信息公告列表
  const fromHome = searchParams.get('from') === 'home';
  const backHref = fromHome ? '/' : '/announcements';
  const backLabel = fromHome ? '返回首页' : '返回信息公告';
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
    <div className="flow-page flex flex-col items-center justify-center gap-4" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="text-5xl">⏳</div>
      <p className="text-[#5a6d8a] font-semibold">正在加载公告...</p>
    </div>
  );

  if (!item) return (
    <div className="flow-page flex flex-col items-center justify-center gap-4" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <div className="text-5xl">📢</div>
      <p className="text-[#5a6d8a] font-semibold">未找到该公告</p>
      <button onClick={() => router.push('/announcements')}
        className="neu-btn-primary">
        返回公告列表
      </button>
    </div>
  );

  return (
    <div className="flow-page" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* ═══ 统一顶栏 ═══ */}
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      {/* ═══ 内容区 ═══ */}
      <div className="relative z-10 px-[clamp(40px,4vw,72px)] pt-3 pb-10">
        <a href={backHref} className="flow-back mb-8"
          onClick={(e) => {
            // 从首页打开时优先 router.back()，让浏览器 bfcache 恢复滚动位置
            if (fromHome && window.history.length > 1) {
              e.preventDefault();
              router.back();
            }
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
          {backLabel}
        </a>
        <div className="glass rounded-2xl p-8">
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
            <div className="mb-6 neu-card p-5">
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
  );
}
