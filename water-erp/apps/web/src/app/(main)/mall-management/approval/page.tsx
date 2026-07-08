'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type CatalogApplication, listCatalogApplications, reviewCatalogApplication } from '@/lib/api/catalog';
import { StatusBadge } from '@/components/workbench';
import { CheckCircle, XCircle, RotateCcw, MessageSquare, ChevronDown, ChevronUp, ClipboardCheck, RefreshCw, Search, X } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待审批', COUNTERED: '议价中', RETURNED: '已退回',
  APPROVED: '已通过', REJECTED: '已拒绝', WITHDRAWN: '已撤回',
};
const TYPE_LABELS: Record<string, string> = { NEW_ITEM: '新增品类', JOIN_EXISTING: '加入供货', UPDATE_QUOTE: '报价调整' };
const statusTone = (s: string): 'blue' | 'purple' | 'orange' | 'green' | 'red' | 'gray' =>
  s === 'PENDING' ? 'blue' : s === 'COUNTERED' ? 'purple' : s === 'RETURNED' ? 'orange' : s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : 'gray';

export default function PriceApprovalPage() {
  const [apps, setApps] = useState<CatalogApplication[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [type, setType] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);
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
    return apps.filter(a => !kw || a.supplier?.name?.includes(kw) || a.proposedName?.includes(kw) || a.catalogItem?.name?.includes(kw) || (a.id && kw === a.id));
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
    setReviewOpen(appId); setReviewAction(action); setReviewReason('');
    setReviewCounterPrice(app?.counterPrice ? Number(app.counterPrice) : (app?.quotedPrice ? Number(app.quotedPrice) : 0));
    setReviewCounterNote('');
    setReviewRefPrice(app?.approvedReferencePrice ? Number(app.approvedReferencePrice) : (app?.quotedPrice ? Number(app.quotedPrice) : 0));
    setReviewPriceMin(0); setReviewPriceMax(0); setReviewValidUntil(''); setReviewCode('');
  };

  const submitReview = async () => {
    if (!reviewOpen || !reviewAction) return;
    setActing(reviewOpen);
    try {
      const body: any = { action: reviewAction };
      if (reviewAction === 'reject' || reviewAction === 'return') body.reason = reviewReason || (reviewAction === 'reject' ? '申请未通过审核' : '请补正后再提交');
      if (reviewAction === 'counter') { body.counterPrice = reviewCounterPrice; body.counterNote = reviewCounterNote; }
      if (reviewAction === 'approve') {
        const app = apps.find(a => a.id === reviewOpen);
        if (app?.type === 'NEW_ITEM') { body.referencePrice = reviewRefPrice; body.priceMin = reviewPriceMin; body.priceMax = reviewPriceMax; if (reviewValidUntil) body.validUntil = reviewValidUntil; if (reviewCode) body.code = reviewCode; }
      }
      await reviewCatalogApplication(reviewOpen, body);
      toast.success({ approve: '已通过', reject: '已拒绝', return: '已退回补正', counter: '已发起议价' }[reviewAction] || '操作成功');
      setReviewOpen(null); setReviewAction(null);
      await load();
    } catch (err: any) { toast.error(err.message || '操作失败'); }
    finally { setActing(null); }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ClipboardCheck size={17} /></div>
            <div>
              <div className="page-hero__title">价格审批</div>
              <div className="page-hero__sub">处理供应商提交的目录报价、新增品类和供货申请，支持审核、议价、退回补正</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
          {[
            { label: '待审批', value: stats.pending, tone: 'blue' as const, sub: '新申请' },
            { label: '议价中', value: stats.countered, tone: 'purple' as const, sub: '协商中' },
            { label: '已退回', value: stats.returned, tone: 'orange' as const, sub: '待补正' },
            { label: '本月已通过', value: stats.approved, tone: 'green' as const, sub: '30日内' },
          ].map(s => (
            <div key={s.label} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{s.label}</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{s.value}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{s.sub}</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* ══════ 工具栏卡片 ══════ */}
      <div className="wb-toolbar">
        <div className="neu-tab-bar">
          {(['PENDING','COUNTERED','RETURNED','APPROVED','REJECTED','WITHDRAWN','全部'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`neu-tab ${status === s ? 'is-active' : ''}`}>{s === '全部' ? s : STATUS_LABELS[s]}</button>
          ))}
        </div>
        <select value={type} onChange={e => setType(e.target.value)} className="workbench-input !w-auto min-w-[110px]"><option value="全部">全部类型</option><option value="NEW_ITEM">新增品类</option><option value="JOIN_EXISTING">加入供货</option><option value="UPDATE_QUOTE">报价调整</option></select>
        <div className="relative flex-1 min-w-[140px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索供应商/目录" className="neu-input !pl-9 w-full text-sm" />{search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}</div>
      </div>

      {/* ══════ 申请列表 ══════ */}
      <div className="neu-table-card">
        {loading ? (
          <div className="p-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><ClipboardCheck size={22} className="text-[var(--muted-foreground)]" /></div>
            <p className="text-sm font-semibold text-[var(--foreground)]">{status === 'PENDING' && type === '全部' && !search.trim() ? '暂无待审批申请' : '无匹配申请记录'}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{status === 'PENDING' ? '供应商提交新的供货申请后将出现在这里' : '尝试切换筛选条件'}</p>
          </div>
        ) : filtered.map(app => {
          const isOpen = expanded.has(app.id);
          const isReviewing = reviewOpen === app.id;
          const canAct = ['PENDING', 'COUNTERED', 'RETURNED'].includes(app.status);
          return (
            <div key={app.id}>
              <div className="flex items-center gap-4 px-5 py-4 cursor-pointer row-clickable" style={{ borderTop: "1px solid oklch(0.55 0.03 258 / 0.06)" }} onClick={() => toggleExpand(app.id)}>
                <StatusBadge tone={statusTone(app.status)}>{STATUS_LABELS[app.status]}</StatusBadge>
                <span className="neu-tab-count">{TYPE_LABELS[app.type] || app.type}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-[var(--foreground)] truncate">{app.type === 'NEW_ITEM' ? app.proposedName || '(未命名)' : app.catalogItem?.name || '(已删除目录)'}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    {app.supplier?.name || '未知供应商'}
                    {app.quotedPrice ? ` · 报价 ¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : ''}
                    {app.counterPrice ? ` · 议价 ¥${Number(app.counterPrice).toLocaleString('zh-CN')}` : ''}
                  </div>
                </div>
                <span className="text-xs text-[var(--muted-foreground)]">{app.createdAt.slice(0, 10)}</span>
                {canAct && (
                  <div className="flex flex-wrap gap-1 ml-2" onClick={e => e.stopPropagation()}>
                    <button disabled={!!acting} onClick={() => startReview(app.id, 'approve')} className="neu-btn-xs is-success">通过</button>
                    <button disabled={!!acting} onClick={() => startReview(app.id, 'counter')} className="neu-btn-xs is-info">议价</button>
                    <button disabled={!!acting} onClick={() => startReview(app.id, 'return')} className="neu-btn-xs is-warning">退回</button>
                    <button disabled={!!acting} onClick={() => startReview(app.id, 'reject')} className="neu-btn-xs is-danger">拒绝</button>
                  </div>
                )}
                {isOpen ? <ChevronUp size={16} className="ml-1 text-[var(--muted-foreground)]/40" /> : <ChevronDown size={16} className="ml-1 text-[var(--muted-foreground)]/40" />}
              </div>
              {isOpen && (
                <div className="px-5 py-4 text-sm space-y-3" style={{ borderTop: "1px solid oklch(0.55 0.03 258 / 0.06)", background: 'oklch(0.985 0.005 258 / 0.45)' }}>
                  <div className="grid gap-3 md:grid-cols-2 text-[0.8rem]">
                    <div><span className="text-[var(--muted-foreground)]">申请类型：</span><span className="font-bold text-[var(--foreground)]">{TYPE_LABELS[app.type] || app.type}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">供应商：</span><span className="font-bold text-[var(--foreground)]">{app.supplier?.name || '-'}</span></div>
                    {app.type === 'NEW_ITEM' ? (
                      <>
                        <div><span className="text-[var(--muted-foreground)]">拟增名称：</span><span className="font-bold text-[var(--foreground)]">{app.proposedName || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增规格：</span><span className="font-bold text-[var(--foreground)]">{app.proposedSpec || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增分类：</span><span className="font-bold text-[var(--foreground)]">{app.proposedCategory || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增分组：</span><span className="font-bold text-[var(--foreground)]">{app.proposedGroup || '-'}</span></div>
                        <div><span className="text-[var(--muted-foreground)]">拟增单位：</span><span className="font-bold text-[var(--foreground)]">{app.proposedUnit || '-'}</span></div>
                      </>
                    ) : (<>
                      <div><span className="text-[var(--muted-foreground)]">目录编码：</span><span className="font-bold text-[var(--foreground)] font-mono text-xs">{app.catalogItem?.code || '-'}</span></div>
                      <div><span className="text-[var(--muted-foreground)]">目录名称：</span><span className="font-bold text-[var(--foreground)]">{app.catalogItem?.name || '-'}</span></div>
                      <div><span className="text-[var(--muted-foreground)]">目录分类：</span><span className="font-bold text-[var(--foreground)]">{app.catalogItem?.category || '-'}</span></div>
                    </>)}
                    <div><span className="text-[var(--muted-foreground)]">报价：</span><span className="font-bold text-[var(--foreground)]">{app.quotedPrice ? `¥${Number(app.quotedPrice).toLocaleString('zh-CN')}` : '未报价'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">区域：</span><span className="font-bold text-[var(--foreground)]">{app.region || '-'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">交货期：</span><span className="font-bold text-[var(--foreground)]">{app.deliveryPeriod || '-'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">最小起订：</span><span className="font-bold text-[var(--foreground)]">{app.minOrder || '-'}</span></div>
                    <div><span className="text-[var(--muted-foreground)]">含税/含运费：</span><span className="font-bold text-[var(--foreground)]">{app.taxIncluded ? '含税' : '不含税'} / {app.freightIncluded ? '含运费' : '不含运费'}</span></div>
                    {app.qualificationNote && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">资质说明：</span>{app.qualificationNote}</div>}
                    {app.counterPrice && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">反报价：</span><span className="font-bold text-[var(--accent-strong)]">¥{Number(app.counterPrice).toLocaleString('zh-CN')}</span>{app.counterNote && <span className="text-[var(--muted-foreground)] ml-2">（{app.counterNote}）</span>}</div>}
                    {app.reviewerNote && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">审核备注：</span>{app.reviewerNote}</div>}
                    {app.rejectReason && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">{app.status === 'RETURNED' ? '退回原因：' : '拒绝原因：'}</span><span className="text-[var(--danger)]">{app.rejectReason}</span></div>}
                    {app.approvedReferencePrice && <div className="md:col-span-2"><span className="text-[var(--muted-foreground)]">通过参考价：</span><span className="font-bold text-[var(--success)]">¥{Number(app.approvedReferencePrice).toLocaleString('zh-CN')}</span></div>}
                  </div>

                  {isReviewing && reviewAction && (
                    <div className="rounded-xl bg-[var(--accent-soft)]/30 p-4 space-y-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3),inset_1px_1px_3px_oklch(0.55_0.03_258/0.06)]">
                      <div className="font-bold text-[var(--accent-strong)]">
                        {reviewAction === 'approve' ? '确认通过申请' : reviewAction === 'reject' ? '确认拒绝申请' : reviewAction === 'return' ? '退回申请补正' : '发起议价'}
                      </div>
                      {reviewAction === 'approve' && app.type === 'NEW_ITEM' && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">参考价 ¥ <input type="number" value={reviewRefPrice} onChange={e => setReviewRefPrice(Number(e.target.value))} className="neu-input text-sm" /></label>
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">价格下限 <input type="number" value={reviewPriceMin} onChange={e => setReviewPriceMin(Number(e.target.value))} className="neu-input text-sm" /></label>
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">价格上限 <input type="number" value={reviewPriceMax} onChange={e => setReviewPriceMax(Number(e.target.value))} className="neu-input text-sm" /></label>
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">目录编码 <input value={reviewCode} onChange={e => setReviewCode(e.target.value)} className="neu-input text-sm" /></label>
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">有效期 <input type="date" value={reviewValidUntil} onChange={e => setReviewValidUntil(e.target.value)} className="neu-input text-sm" /></label>
                        </div>
                      )}
                      {(reviewAction === 'reject' || reviewAction === 'return') && (
                        <label className="block space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">
                          {reviewAction === 'reject' ? '拒绝原因' : '退回原因'}
                          <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)} className="neu-input w-full text-sm" rows={3} placeholder={reviewAction === 'reject' ? '如：报价高于市场平均 30%' : '如：请补充规格型号参数'} />
                        </label>
                      )}
                      {reviewAction === 'counter' && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">反报价 ¥ <input type="number" value={reviewCounterPrice} onChange={e => setReviewCounterPrice(Number(e.target.value))} className="neu-input text-sm" /></label>
                          <label className="space-y-1 text-[11px] font-bold text-[var(--muted-foreground)]">议价说明 <input value={reviewCounterNote} onChange={e => setReviewCounterNote(e.target.value)} className="neu-input text-sm" placeholder="如：参考市场价 95 元" /></label>
                        </div>
                      )}
                      <div className="flex gap-2 pt-2">
                        <button disabled={!!acting} onClick={submitReview} className="neu-btn-soft">{acting ? '提交中...' : '确认提交'}</button>
                        <button onClick={() => { setReviewOpen(null); setReviewAction(null); }} className="neu-btn-soft">取消</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
