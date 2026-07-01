// requirement-compare-panel.tsx
'use client';
import { useState } from 'react';
import { Star, ExternalLink, CheckCircle, AlertCircle, HelpCircle, XCircle } from 'lucide-react';
import type { RequirementResponse, BidRequirementReview } from '@water-erp/shared';
import { api } from '@/lib/api';

interface ReqItem { id: string; category: string; content: string; isStarred?: boolean; acceptanceCriteria?: string; threshold?: string; evidenceType?: string; }

const CAT_LABEL: Record<string, string> = { qualification: '资格要求', technical: '技术要求', commercial: '商务要求' };
const STATUS_CFG: Record<string, { label: string; color: string; icon: any }> = {
  met: { label: '满足', color: 'text-emerald-600', icon: CheckCircle },
  partial: { label: '部分', color: 'text-amber-600', icon: HelpCircle },
  unmet: { label: '不满足', color: 'text-red-600', icon: XCircle },
  not_found: { label: '未提及', color: 'text-[oklch(0.55_0.01_264)]', icon: AlertCircle },
};

export function RequirementComparePanel({
  projectId, supplierId, requirements, responses, reviews,
}: {
  projectId: string; supplierId: string;
  requirements: any; responses: RequirementResponse[]; reviews: BidRequirementReview[];
}) {
  const [local, setLocal] = useState<Record<string, BidRequirementReview>>(
    () => Object.fromEntries(reviews.map((r) => [r.requirementId, r])),
  );

  const flat: ReqItem[] = [
    ...(requirements?.qualificationRequirements ?? []).map((r: any) => ({ ...r, category: 'qualification' })),
    ...(requirements?.technicalRequirements ?? []).map((r: any) => ({ ...r, category: 'technical' })),
    ...(requirements?.commercialRequirements ?? []).map((r: any) => ({ ...r, category: 'commercial' })),
  ];
  const respBy = (id: string) => responses.find((r) => r.requirementId === id);

  const setVerdict = async (item: ReqItem, verdict: 'ack' | 'dispute' | 'doubt') => {
    const prevReview = local[item.id];
    const next = { ...prevReview, requirementId: item.id, category: item.category, verdict, note: prevReview?.note ?? '' };
    setLocal((cur) => ({ ...cur, [item.id]: next }));
    try {
      await api.post(`/expert/projects/${projectId}/assist/${supplierId}/reviews`, {
        requirementId: item.id, category: item.category, verdict, note: next.note,
      });
    } catch {
      // 回滚到点击前的 verdict —— 否则 UI 显示新值而 server 仍是旧值，专家以为标注成功实为数据丢失
      setLocal((cur) => ({ ...cur, [item.id]: prevReview }));
      /* toast 由全局拦截器处理 */
    }
  };
  const setNote = (item: ReqItem, note: string) => {
    const verdict = local[item.id]?.verdict ?? 'doubt';
    setLocal((cur) => ({ ...cur, [item.id]: { requirementId: item.id, category: item.category, verdict, note } }));
  };
  const saveNote = async (item: ReqItem) => {
    const r = local[item.id];
    if (!r) return;
    try {
      await api.post(`/expert/projects/${projectId}/assist/${supplierId}/reviews`, {
        requirementId: item.id, category: item.category, verdict: r.verdict, note: r.note,
      });
    } catch { /* toast 由全局拦截器处理 */ }
  };

  if (!flat.length) {
    return <div className="text-center py-6 text-xs text-[oklch(0.55_0.01_264)]">招标条款分析中或暂无条款数据</div>;
  }

  const grouped = ['qualification', 'technical', 'commercial'] as const;
  return (
    <div className="space-y-3">
      {grouped.map((cat) => {
        const items = flat.filter((i) => i.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="glass-card glass-card-lighter rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[oklch(0.91_0.006_264)] bg-white/40">
              <span className="font-bold text-sm text-[var(--color-text)]">{CAT_LABEL[cat]}</span>
              {cat === 'technical' && <span className="text-[10px] text-amber-600">★ 号为实质性条款</span>}
            </div>
            <div className="divide-y divide-[oklch(0.94_0.004_264)]">
              {items.map((item) => {
                const resp = respBy(item.id);
                const review = local[item.id];
                const isDispute = review?.verdict === 'dispute';
                const sc = resp ? STATUS_CFG[resp.status] : null;
                return (
                  <div key={item.id} className={`grid grid-cols-12 gap-3 p-3 ${isDispute ? 'bg-amber-50' : ''}`}>
                    {/* 招标条款 */}
                    <div className="col-span-5">
                      <div className="flex items-start gap-1.5">
                        {item.isStarred && <Star size={12} className="text-amber-500 fill-amber-400 shrink-0 mt-0.5" />}
                        <p className="text-xs text-[var(--color-text)] leading-relaxed">{item.content}</p>
                      </div>
                      {(item.acceptanceCriteria || item.threshold) && (
                        <p className="text-[10px] text-[oklch(0.55_0.01_264)] mt-1 ml-5">验收/阈值：{item.acceptanceCriteria || item.threshold}</p>
                      )}
                    </div>
                    {/* AI 响应 */}
                    <div className="col-span-4">
                      {resp && sc ? (
                        <>
                          <div className={`flex items-center gap-1 text-xs font-semibold ${sc.color}`}>
                            <sc.icon size={12} /> {sc.label}
                          </div>
                          {resp.excerpt && <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed">“{resp.excerpt}”</p>}
                          {resp.location && (
                            <a href={`/api/expert/projects/${projectId}/suppliers/${supplierId}/documents/${resp.location.fileId}#page=${resp.location.page}`} target="_blank" rel="noopener"
                              className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-primary)] hover:underline mt-1">
                              <ExternalLink size={10} /> 投标原文第 {resp.location.page} 页
                            </a>
                          )}
                        </>
                      ) : <span className="text-[10px] text-[oklch(0.55_0.01_264)]">AI 响应定位中</span>}
                    </div>
                    {/* 标注 */}
                    <div className="col-span-3">
                      <div className="flex gap-1.5 mb-1">
                        {(['ack', 'dispute', 'doubt'] as const).map((v) => (
                          <button key={v} onClick={() => setVerdict(item, v)}
                            className={`text-[10px] px-2 py-0.5 rounded border ${
                              review?.verdict === v
                                ? v === 'ack' ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                                  : v === 'dispute' ? 'bg-red-100 border-red-300 text-red-700'
                                  : 'bg-amber-100 border-amber-300 text-amber-700'
                                : 'border-[oklch(0.91_0.006_264)] text-[oklch(0.55_0.01_264)] hover:bg-white/60'
                            }`}>
                            {v === 'ack' ? '认可' : v === 'dispute' ? '异议' : '存疑'}
                          </button>
                        ))}
                      </div>
                      {review && (
                        <textarea
                          value={review.note ?? ''} onChange={(e) => setNote(item, e.target.value)} onBlur={() => saveNote(item)}
                          placeholder="备注（可选）" rows={1}
                          className="w-full text-[10px] px-2 py-1 rounded border border-[oklch(0.91_0.006_264)] bg-white/70 resize-none focus:outline-none focus:border-[var(--color-primary)]" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-[oklch(0.55_0.01_264)] text-center">标注仅本人可见；异议将在评审报告中披露，并在打分页提示核对。</p>
    </div>
  );
}
