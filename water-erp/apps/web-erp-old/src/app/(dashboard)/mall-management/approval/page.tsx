'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type CatalogApplication, listCatalogApplications, reviewCatalogApplication } from '@/lib/api/catalog';
import { DataToolbar, MetricCard, PageHero, StatusBadge, Skeleton } from '@/components/workbench';
import { CheckCircle, XCircle, RotateCcw, MessageSquare, Eye, ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待审批', COUNTERED: '议价中', RETURNED: '已退回',
  APPROVED: '已通过', REJECTED: '已拒绝', WITHDRAWN: '已撤回',
};
const TYPE_LABELS: Record<string, string> = { NEW_ITEM: '新增品类', JOIN_EXISTING: '加入供货', UPDATE_QUOTE: '报价调整' };

const statusBadge: Record<string, string> = {
  PENDING: 'bg-blue-50 text-blue-700 border-blue-200',
  COUNTERED: 'bg-purple-50 text-purple-700 border-purple-200',
  RETURNED: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  WITHDRAWN: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function PriceApprovalPage() {
  const [apps, setApps] = useState<CatalogApplication[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [type, setType] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);

  // Review form state
  const [reviewOpen, setReviewOpen] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'return' | 'counter' | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewCounterPrice, setReviewCounterPrice] = useState<number>(0);
  const [reviewCounterNote, setReviewCounterNote] = useState('');
  const [reviewRefPrice, setReviewRefPrice] = useState<number>(0);
  const [reviewPriceMin, setReviewPriceMin] = useState<number>(0);
  const [reviewPriceMax, setReviewPriceMax] = useState<number>(0);
  const [reviewValidUntil, setReviewValidUntil] = useState('');
  const [reviewCode, setReviewCode] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const list = await listCatalogApplications({ status: status === '全部' ? undefined : status, type: type === '全部' ? undefined : type });
      setApps(list);
    } catch (err: any) { toast.error(err.message || '加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [status, type]);

  const filtered = useMemo(() => {
    const kw = search.trim();
    return apps.filter(a => !kw ||
      a.supplier?.name?.includes(kw) ||
      a.proposedName?.includes(kw) ||
      a.catalogItem?.name?.includes(kw) ||
      (a.id && kw === a.id));
  }, [apps, search]);

  const stats = useMemo(() => {
    const pending = apps.filter(a => a.status === 'PENDING').length;
    const countered = apps.filter(a => a.status === 'COUNTERED').length;
    const returned = apps.filter(a => a.status === 'RETURNED').length;
    const approved = apps.filter(a => a.status === 'APPROVED' && (a.reviewedAt ? new Date(a.reviewedAt) >= new Date(Date.now() - 30 * 86400000) : false)).length;
    return { pending, countered, returned, approved };
  }, [apps]);

  const toggleExpand = (id: string) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const startReview = (appId: string, action: 'approve' | 'reject' | 'return' | 'counter') => {
    const app = apps.find(a => a.id === appId);
    setReviewOpen(appId);
    setReviewAction(action);
    setReviewReason('');
    setReviewCounterPrice(app?.counterPrice ? Number(app.counterPrice) : (app?.quotedPrice ? Number(app.quotedPrice) : 0));
    setReviewCounterNote('');
    setReviewRefPrice(app?.approvedReferencePrice ? Number(app.approvedReferencePrice) : (app?.quotedPrice ? Number(app.quotedPrice) : 0));
    setReviewPriceMin(0);
    setReviewPriceMax(0);
    setReviewValidUntil('');
    setReviewCode('');
  };

  const submitReview = async () => {
    if (!reviewOpen || !reviewAction) return;
    setActing(reviewOpen);
    try {
      const body: any = { action: reviewAction };
      if (reviewAction === 'reject' || reviewAction === 'return') {
        body.reason = reviewReason || (reviewAction === 'reject' ? '申请未通过审核' : '请补正后再提交');
      }
      if (reviewAction === 'counter') {
        body.counterPrice = reviewCounterPrice;
        body.counterNote = reviewCounterNote;
      }
      if (reviewAction === 'approve') {
        const app = apps.find(a => a.id === reviewOpen);
        if (app?.type === 'NEW_ITEM') {
          body.referencePrice = reviewRefPrice;
          body.priceMin = reviewPriceMin;
          body.priceMax = reviewPriceMax;
          if (reviewValidUntil) body.validUntil = reviewValidUntil;
          if (reviewCode) body.code = reviewCode;
        }
      }
      await reviewCatalogApplication(reviewOpen, body);
      toast.success({ approve: '已通过', reject: '已拒绝', return: '已退回补正', counter: '已发起议价' }[reviewAction] || '操作成功');
      setReviewOpen(null);
      setReviewAction(null);
      await load();
    } catch (err: any) { toast.error(err.message || '操作失败'); }
    finally { setActing(null); }
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="价格审批"
        description="处理供应商提交的目录报价、新增品类和供货申请，支持审核、议价、退回补正。"
        tone="blue"
        icon={<ClipboardCheck size={14} />}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="待审批" value={stats.pending} tone="blue" />
        <MetricCard label="议价中" value={stats.countered} tone="purple" />
        <MetricCard label="已退回" value={stats.returned} tone="orange" />
        <MetricCard label="本月已通过" value={stats.approved} tone="green" />
      </div>

      <DataToolbar>
        <select value={status} onChange={e => setStatus(e.target.value)} className="workbench-input text-sm font-medium">
          <option value="PENDING">待审批</option><option value="COUNTERED">议价中</option><option value="RETURNED">已退回</option>
          <option value="APPROVED">已通过</option><option value="REJECTED">已拒绝</option><option value="WITHDRAWN">已撤回</option>
          <option value="全部">全部状态</option>
        </select>
        <select value={type} onChange={e => setType(e.target.value)} className="workbench-input text-sm font-medium">
          <option value="全部">全部类型</option><option value="NEW_ITEM">新增品类</option>
          <option value="JOIN_EXISTING">加入供货</option><option value="UPDATE_QUOTE">报价调整</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索供应商/目录/申请ID" className="workbench-input flex-1 text-sm" />
        <button onClick={load} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white">刷新</button>
      </DataToolbar>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card glass-card-lighter rounded-2xl p-5">
              <div className="flex items-center gap-4">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-48 rounded" />
                  <Skeleton className="mt-1.5 h-3 w-32 rounded" />
                </div>
                <Skeleton className="h-4 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card glass-card-lighter rounded-2xl border-dashed border-[#b8c7dc]/40 p-10 text-center">
          <div className="text-lg font-black text-[#18243a]">
            {status === 'PENDING' && type === '全部' && !search.trim() ? '暂无待审批申请' : '无匹配申请记录'}
          </div>
          <p className="mt-2 text-sm text-[#5a6d8a]">
            {status === 'PENDING' ? '供应商提交新的供货申请后将出现在这里。' : '尝试切换筛选条件查看其他状态的申请。'}
          </p>
        </div>
      ) : filtered.map(app => {
        const isOpen = expanded.has(app.id);
        const isReviewing = reviewOpen === app.id;
        const canAct = ['PENDING', 'COUNTERED', 'RETURNED'].includes(app.status);

        return (
          <div key={app.id} className="glass-card glass-card-lighter rounded-2xl">
            {/* Summary row */}
            <div className="flex items-center gap-4 px-5 py-4 cursor-pointer" onClick={() => toggleExpand(app.id)}>
              <StatusBadge tone={app.status === "APPROVED" ? "green" : app.status === "PENDING" ? "blue" : app.status === "COUNTERED" ? "purple" : app.status === "RETURNED" ? "orange" : app.status === "REJECTED" ? "red" : "gray"}>{STATUS_LABELS[app.status]}</StatusBadge>
              <span className="rounded-full bg-[#f3f7fc] px-2 py-0.5 text-xs font-bold text-[#5a6d8a]">{TYPE_LABELS[app.type] || app.type}</span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[#18243a] text-sm truncate">
                  {app.type === 'NEW_ITEM' ? app.proposedName || '(未命名)' : app.catalogItem?.name || '(已删除目录)'}
                </div>
                <div className="text-xs text-[#8a99ad]">
                  {app.supplier?.name || '未知供应商'}
                  {app.quotedPrice ? ` · 报价 ¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : ''}
                  {app.counterPrice ? ` · 议价 ¥${Number(app.counterPrice).toLocaleString('zh-CN')}` : ''}
                </div>
              </div>
              <span className="text-xs text-[#8a99ad]">{app.createdAt.slice(0, 10)}</span>
              {canAct && (
                <div className="flex gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                  <button disabled={!!acting} onClick={() => startReview(app.id, 'approve')} className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-100" title="通过">
                    <CheckCircle size={14} className="inline mr-0.5" />通过
                  </button>
                  <button disabled={!!acting} onClick={() => startReview(app.id, 'counter')} className="rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-700 border border-purple-200 hover:bg-purple-100" title="议价">
                    <MessageSquare size={14} className="inline mr-0.5" />议价
                  </button>
                  <button disabled={!!acting} onClick={() => startReview(app.id, 'return')} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-200 hover:bg-amber-100" title="退回补正">
                    <RotateCcw size={14} className="inline mr-0.5" />退回
                  </button>
                  <button disabled={!!acting} onClick={() => startReview(app.id, 'reject')} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 border border-red-200 hover:bg-red-100" title="拒绝">
                    <XCircle size={14} className="inline mr-0.5" />拒绝
                  </button>
                </div>
              )}
              {!canAct && <Eye size={16} className="ml-2 text-[#b8c7dc]" />}
              {isOpen ? <ChevronUp size={16} className="ml-1 text-[#b8c7dc]" /> : <ChevronDown size={16} className="ml-1 text-[#b8c7dc]" />}
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div className="border-t border-[#edf2f7]/40 px-5 py-4 text-sm space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div><span className="text-[#8a99ad]">申请类型：</span><span className="font-bold text-[#18243a]">{TYPE_LABELS[app.type] || app.type}</span></div>
                  <div><span className="text-[#8a99ad]">供应商：</span><span className="font-bold text-[#18243a]">{app.supplier?.name || '-'}</span></div>
                  {app.type === 'NEW_ITEM' ? (
                    <>
                      <div><span className="text-[#8a99ad]">拟增名称：</span><span className="font-bold text-[#18243a]">{app.proposedName || '-'}</span></div>
                      <div><span className="text-[#8a99ad]">拟增规格：</span><span className="font-bold text-[#18243a]">{app.proposedSpec || '-'}</span></div>
                      <div><span className="text-[#8a99ad]">拟增分类：</span><span className="font-bold text-[#18243a]">{app.proposedCategory || '-'}</span></div>
                      <div><span className="text-[#8a99ad]">拟增分组：</span><span className="font-bold text-[#18243a]">{app.proposedGroup || '-'}</span></div>
                      <div><span className="text-[#8a99ad]">拟增单位：</span><span className="font-bold text-[#18243a]">{app.proposedUnit || '-'}</span></div>
                    </>
                  ) : (
                    <>
                      <div><span className="text-[#8a99ad]">目录编码：</span><span className="font-bold text-[#18243a] font-mono text-xs">{app.catalogItem?.code || '-'}</span></div>
                      <div><span className="text-[#8a99ad]">目录名称：</span><span className="font-bold text-[#18243a]">{app.catalogItem?.name || '-'}</span></div>
                      <div><span className="text-[#8a99ad]">目录分类：</span><span className="font-bold text-[#18243a]">{app.catalogItem?.category || '-'}</span></div>
                    </>
                  )}
                  <div><span className="text-[#8a99ad]">报价：</span><span className="font-bold text-[#18243a]">{app.quotedPrice ? `¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : '未报价'}</span></div>
                  <div><span className="text-[#8a99ad]">区域：</span><span className="font-bold text-[#18243a]">{app.region || '-'}</span></div>
                  <div><span className="text-[#8a99ad]">交货期：</span><span className="font-bold text-[#18243a]">{app.deliveryPeriod || '-'}</span></div>
                  <div><span className="text-[#8a99ad]">最小起订：</span><span className="font-bold text-[#18243a]">{app.minOrder || '-'}</span></div>
                  <div><span className="text-[#8a99ad]">含税/含运费：</span><span className="font-bold text-[#18243a]">{app.taxIncluded ? '含税' : '不含税'} / {app.freightIncluded ? '含运费' : '不含运费'}</span></div>
                  {app.qualificationNote && <div className="md:col-span-2"><span className="text-[#8a99ad]">资质说明：</span><span>{app.qualificationNote}</span></div>}
                  {app.counterPrice && <div className="md:col-span-2"><span className="text-[#8a99ad]">管理员反报价：</span><span className="font-bold text-purple-700">¥{Number(app.counterPrice).toLocaleString('zh-CN')}</span>{app.counterNote && <span className="text-[#8a99ad] ml-2">（{app.counterNote}）</span>}</div>}
                  {app.reviewerNote && <div className="md:col-span-2"><span className="text-[#8a99ad]">审核备注：</span><span>{app.reviewerNote}</span></div>}
                  {app.rejectReason && <div className="md:col-span-2"><span className="text-[#8a99ad]">{app.status === 'RETURNED' ? '退回原因：' : '拒绝原因：'}</span><span className="text-red-700">{app.rejectReason}</span></div>}
                  {app.approvedReferencePrice && <div className="md:col-span-2"><span className="text-[#8a99ad]">通过时参考价：</span><span className="font-bold text-emerald-700">¥{Number(app.approvedReferencePrice).toLocaleString('zh-CN')}</span></div>}
                  <div><span className="text-[#8a99ad]">提交时间：</span><span>{app.createdAt.slice(0, 19).replace('T', ' ')}</span></div>
                  <div><span className="text-[#8a99ad]">审核时间：</span><span>{app.reviewedAt ? app.reviewedAt.slice(0, 19).replace('T', ' ') : '-'}</span></div>
                </div>

                {/* Inline review form */}
                {isReviewing && reviewAction && (
                  <div className="rounded-xl border border-[#064ea2] bg-[#f0f5ff] p-4 space-y-3 mt-4">
                    <div className="font-bold text-[#064ea2]">
                      {reviewAction === 'approve' ? '确认通过申请' : reviewAction === 'reject' ? '确认拒绝申请' : reviewAction === 'return' ? '退回申请补正' : '发起议价'}
                    </div>

                    {reviewAction === 'approve' && app.type === 'NEW_ITEM' && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          参考价 ¥ <input type="number" value={reviewRefPrice} onChange={e => setReviewRefPrice(Number(e.target.value))} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" />
                        </label>
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          价格下限 <input type="number" value={reviewPriceMin} onChange={e => setReviewPriceMin(Number(e.target.value))} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" />
                        </label>
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          价格上限 <input type="number" value={reviewPriceMax} onChange={e => setReviewPriceMax(Number(e.target.value))} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" />
                        </label>
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          目录编码（可选）<input value={reviewCode} onChange={e => setReviewCode(e.target.value)} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" placeholder={app.proposedName ? `如 CAT-${app.proposedName.slice(0, 6).toUpperCase()}` : ''} />
                        </label>
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          有效期 <input type="date" value={reviewValidUntil} onChange={e => setReviewValidUntil(e.target.value)} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" />
                        </label>
                      </div>
                    )}

                    {(reviewAction === 'reject' || reviewAction === 'return') && (
                      <label className="block space-y-1 text-xs font-bold text-[#5a6d8a]">
                        {reviewAction === 'reject' ? '拒绝原因' : '退回原因（需供应商补正的内容）'}
                        <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" rows={3}
                          placeholder={reviewAction === 'reject' ? '如：报价高于市场平均 30%，申请不予通过' : '如：请补充规格型号参数，重新提交检测报告'} />
                      </label>
                    )}

                    {reviewAction === 'counter' && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          反报价 ¥ <input type="number" value={reviewCounterPrice} onChange={e => setReviewCounterPrice(Number(e.target.value))} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" />
                        </label>
                        <label className="space-y-1 text-xs font-bold text-[#5a6d8a]">
                          议价说明 <input value={reviewCounterNote} onChange={e => setReviewCounterNote(e.target.value)} className="w-full rounded-lg border border-[#d5e0ef] px-3 py-2 text-sm" placeholder="如：参考市场价 95 元，建议调整至该价格" />
                        </label>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button disabled={!!acting} onClick={submitReview} className="rounded-xl bg-[#064ea2] px-5 py-2 text-sm font-bold text-white disabled:opacity-60">
                        {acting ? '提交中...' : '确认提交'}
                      </button>
                      <button onClick={() => { setReviewOpen(null); setReviewAction(null); }} className="rounded-xl border border-[#d5e0ef] px-4 py-2 text-sm font-bold text-[#5a6d8a]">取消</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
