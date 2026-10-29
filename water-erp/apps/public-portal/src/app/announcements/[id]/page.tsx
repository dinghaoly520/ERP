'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Download, FileText, Paperclip, PhoneCall } from 'lucide-react';
import { fetchPublicAnnouncement, downloadAnnouncementAttachment, ANNOUNCEMENTS, type AnnouncementItem, ANNOUNCEMENT_TYPE_META, formatMetaValue, type MetaField } from '@/lib/announcements';
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
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublicAnnouncement(id)
      .then(data => { if (!cancelled) setItem(data); })
      .catch((e) => {
        // Fallback to local data；无本地兜底时透出后端业务文案（如「该公告已下线」）
        if (!cancelled) {
          const found = ANNOUNCEMENTS.find(a => a.id === id) || null;
          setItem(found);
          if (!found) setErrMsg(e instanceof Error ? e.message : '公告加载失败');
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
      <div className="text-5xl">{errMsg?.includes('已下线') ? '📩' : '📢'}</div>
      <p className="text-[#5a6d8a] font-semibold">{errMsg ?? '未找到该公告'}</p>
      <button onClick={() => router.push('/announcements')}
        className="neu-btn-primary">
        返回公告列表
      </button>
    </div>
  );

  return (
    <div className="flow-page" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <FlowBackdrop />
      {/* 统一顶栏 */}
      <UnifiedHeader />

      {/* 内容区 */}
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

          {/* 元信息 —— 发布单位（2026-10-16）：公告必须标明公司（创建时写时快照） */}
          <div className="flex items-center gap-5 text-sm text-[#8a96aa] mb-4">
            <span>发布时间：{item.date}</span>
            {item.companyName ? <span>发布单位：{item.companyName}</span> : null}
          </div>

          {/* 公示期满/已下线提示页（2026-10-20 用户裁定）：标题等元信息保留，正文不再显示 */}
          {item.titleOnly && (
            <div className="mb-6 rounded-2xl px-6 py-10 text-center"
              style={{ background: 'oklch(0.5 0.16 258 / 0.06)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
              <div className="text-4xl mb-4">📭</div>
              <p className="text-lg font-bold text-[#18243a] mb-2">
                {item.offlinedReason === 'PUBLICITY_ENDED' ? '该公告公示期已过，不再显示公示内容' : '该公告已下线'}
              </p>
              <p className="text-sm text-[#8a96aa]">
                公告标题与发布信息保留备查；公示期满不代表截标/开标时间已到，投标供应商请登录供应商门户在「项目机会」查看完整公告与采购文件。
              </p>
            </div>
          )}

          {/* 结构化元数据（项目编号/招标方式/预算金额/时间等）—— 与采购管理工作台一致 */}
          {!item.titleOnly && (() => {
            const meta = item.metadata || {};
            const fields = (ANNOUNCEMENT_TYPE_META[item.type] || []).filter(f => meta[f.key]);
            if (fields.length === 0) return null;
            const shortFields = fields.filter(f => !f.area);
            const areaFields = fields.filter(f => f.area);
            return (
              <div className="mb-6 pb-6 border-b border-[#e5ecf4]">
                {shortFields.length > 0 && (
                  <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                    {shortFields.map(f => {
                      const isCode = f.key === 'projectCode' || f.key === 'docNo';
                      const isMoney = f.key === 'budget' || f.key === 'amount';
                      const isDate = f.date;
                      const labelColor = isCode ? '#064ea2' : isMoney ? '#18a56c' : isDate ? '#f5a623' : '#8a96aa';
                      const valueColor = isCode ? '#064ea2' : isMoney ? '#18a56c' : '#26364e';
                      return (
                        <span key={f.key} className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5"
                          style={{ background: 'oklch(1 0 0 / 0.55)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 1px 2px oklch(0.55 0.03 258 / 0.08)' }}>
                          <span className="text-[11px] font-bold tracking-wide" style={{ color: labelColor }}>{f.label}</span>
                          {/* 采购文件下载时间：新公告存区间（downloadPeriod），旧公告止点（downloadDeadline）——区间优先 */}
                          <span className="text-[13px] font-semibold" style={{ color: valueColor }}>{formatMetaValue(f, f.key === 'downloadDeadline' ? (meta.downloadPeriod ?? meta.downloadDeadline) : meta[f.key])}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {areaFields.map(f => (
                  <div key={f.key} className="mt-3 rounded-lg px-4 py-3"
                    style={{ background: 'oklch(0.5 0.16 258 / 0.06)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                    <span className="text-[11px] font-bold tracking-wide" style={{ color: '#064ea2' }}>{f.label}</span>
                    <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: '#26364e' }}>{meta[f.key]}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* AI 摘要 */}
          {item.aiSummary && (
            <div className="mb-6 neu-card p-5">
              <div className="mb-2 text-sm font-bold text-[#064ea2]">AI 摘要</div>
              <p className="text-[15px] leading-8 text-[#26364e]">{item.aiSummary}</p>
            </div>
          )}

          {/* 正文（标题壳不渲染——空 content 由上方提示页替代） */}
          {!item.titleOnly && (
            <div
              className="announcement-detail-content text-[15px] text-[#18243a] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: item.content }}
            />
          )}

          {/* 公告附件（2026-10-28 用户裁定）：公告组成部分，信息门户/公告中心/项目机会三端可下载；
              公开下载端点按公告可见性闸门（定向/保密公告匿名读不到详情，附件天然不渲染） */}
          {!item.titleOnly && (item.attachments?.length ?? 0) > 0 && (
            <div className="neu-card mt-8 p-5">
              <div className="mb-3 flex items-center gap-2">
                <Paperclip size={14} style={{ color: '#064ea2' }} />
                <span className="text-sm font-bold" style={{ color: '#064ea2' }}>公告附件</span>
                <span className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-[#8a96aa]"
                  style={{ background: 'oklch(0.5 0.16 258 / 0.08)' }}>
                  {item.attachments!.length} 个
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {item.attachments!.map(att => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => {
                      downloadAnnouncementAttachment(att)
                        .catch(e => toast.error(e instanceof Error ? e.message : '附件下载失败'));
                    }}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[oklch(0.5_0.16_258/0.06)] active:bg-[oklch(0.5_0.16_258/0.1)]"
                  >
                    <FileText size={14} className="shrink-0" style={{ color: '#064ea2' }} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" style={{ color: '#064ea2' }}>
                      {att.title || att.fileAsset?.originalName || '附件'}
                    </span>
                    <Download size={14} className="shrink-0 text-[#8a96aa]" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 异议联系方式：发布时自澄清说明快照写入，公告阅读后单独展示（标题壳不渲染） */}
          {!item.titleOnly && (() => {
            const oc = String(item.metadata?.objectionContact ?? '').trim();
            if (!oc) return null;
            const isHtml = /<[a-z][\s\S]*>/i.test(oc);
            return (
              <div className="mt-8 rounded-2xl px-5 py-4"
                style={{ background: 'oklch(0.5 0.16 258 / 0.06)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), inset -1px -1px 3px oklch(0.55 0.03 258 / 0.05)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <PhoneCall size={14} style={{ color: '#064ea2' }} />
                  <span className="text-sm font-bold" style={{ color: '#064ea2' }}>异议联系方式</span>
                </div>
                {isHtml ? (
                  <div className="text-[14px] leading-relaxed text-[#26364e] announcement-detail-content" dangerouslySetInnerHTML={{ __html: oc }} />
                ) : (
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-[#26364e]">{oc}</p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
