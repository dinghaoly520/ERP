'use client';

import { useEffect, useState, useCallback } from 'react';
import { DataToolbar, MetricCard, PageHero, StatusBadge } from '@/components/workbench';
import { Building2, ClipboardCheck } from 'lucide-react';
import {
  listCatalogApplications,
  reviewCatalogApplication,
  type CatalogApplication,
} from '@/lib/api/catalog';

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待审核', color: '#0a5eb8', bg: '#0a5eb818' },
  COUNTERED: { label: '议价中', color: '#d97706', bg: '#d9770618' },
  RETURNED: { label: '已退回', color: '#e67e22', bg: '#e67e2218' },
  APPROVED: { label: '已通过', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '已拒绝', color: '#e74c3c', bg: '#e74c3c18' },
  WITHDRAWN: { label: '已撤回', color: '#95a5a6', bg: '#95a5a618' },
};

const typeMap: Record<string, { label: string; color: string; bg: string }> = {
  NEW_ITEM: { label: '新增品类', color: '#6d28d9', bg: '#6d28d918' },
  JOIN_EXISTING: { label: '加入供货', color: '#1d4ed8', bg: '#1d4ed818' },
  UPDATE_QUOTE: { label: '改报价', color: '#b45309', bg: '#b4530918' },
};

type TabKey = 'PENDING' | 'COUNTERED' | 'DONE' | 'ALL';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'PENDING', label: '待审核' },
  { key: 'COUNTERED', label: '议价中' },
  { key: 'DONE', label: '已处理' },
  { key: 'ALL', label: '全部' },
];

type ReviewAction = 'approve' | 'reject' | 'return' | 'counter';

export default function CatalogReviewPage() {
  const [tab, setTab] = useState<TabKey>('PENDING');
  const [list, setList] = useState<CatalogApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CatalogApplication | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === 'ALL' ? undefined
        : tab === 'DONE' ? undefined
        : tab;
      let data = await listCatalogApplications(status ? { status } : {});
      if (tab === 'DONE') {
        data = data.filter(a => ['APPROVED', 'REJECTED', 'WITHDRAWN', 'RETURNED'].includes(a.status));
      }
      setList(data);
    } catch { setList([]); }
    setLoading(false);
  }, [tab]);

  useEffect(() => { loadList(); }, [loadList]);

  const counts = {
    PENDING: list.filter(a => a.status === 'PENDING').length,
    COUNTERED: list.filter(a => a.status === 'COUNTERED').length,
  };

  // 切换 tab 时重新加载计数（用 ALL 拉一次全量）
  const [globalCounts, setGlobalCounts] = useState({ PENDING: 0, COUNTERED: 0, RETURNED: 0 });
  useEffect(() => {
    listCatalogApplications().then(all => {
      setGlobalCounts({
        PENDING: all.filter(a => a.status === 'PENDING').length,
        COUNTERED: all.filter(a => a.status === 'COUNTERED').length,
        RETURNED: all.filter(a => a.status === 'RETURNED').length,
      });
    }).catch(() => {});
  }, [loading]);

  return (
    <div>
      <PageHero eyebrow="供应商管理中心" title="目录供货审核" description="审核供应商的「新增品类 / 加入供货 / 改报价」申请，支持议价改价后通过。" tone="green" icon={<Building2 size={14} />} />

      {/* 待办计数 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { key: 'PENDING', label: '待审核', count: globalCounts.PENDING, color: '#0a5eb8' },
          { key: 'COUNTERED', label: '议价中', count: globalCounts.COUNTERED, color: '#d97706' },
          { key: 'RETURNED', label: '已退回待补正', count: globalCounts.RETURNED, color: '#e67e22' },
        ].map(c => (
          <button
            key={c.key}
            onClick={() => setTab(c.key as TabKey)}
            className={`text-left bg-white rounded-xl border p-5 transition ${tab === c.key ? 'border-[#064ea2] ring-1 ring-[#064ea2]' : 'border-[#e5ecf4] hover:border-[#bcd0e8]'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#5a6d8a]">{c.label}</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
            </div>
            <p className="text-3xl font-bold mt-1" style={{ color: c.color }}>{c.count}</p>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-lg transition ${tab === t.key ? 'bg-[#064ea2] text-white' : 'bg-white border border-[#e5ecf4] text-[#5a6d8a] hover:border-[#bcd0e8]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
              <th className="px-5 py-3">供应商</th>
              <th className="px-5 py-3">类型</th>
              <th className="px-5 py-3">目标物资</th>
              <th className="px-5 py-3">报价</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">提交时间</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[#5a6d8a]">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[#5a6d8a]">暂无申请</td></tr>
            ) : list.map(a => {
              const st = statusMap[a.status] || { label: a.status, color: '#999', bg: '#99918' };
              const ty = typeMap[a.type] || { label: a.type, color: '#999', bg: '#99918' };
              return (
                <tr key={a.id} className="border-b border-[#e5ecf4] hover:bg-[#f8fafc]">
                  <td className="px-5 py-3 font-semibold text-[#18243a]">{a.supplier?.name || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: ty.color, backgroundColor: ty.bg }}>{ty.label}</span>
                  </td>
                  <td className="px-5 py-3">
                    {a.type === 'NEW_ITEM' ? (
                      <div>
                        <div className="font-semibold text-[#18243a]">{a.proposedName}</div>
                        <div className="text-xs text-[#8a96aa]">{a.proposedGroup} / {a.proposedCategory} · {a.proposedUnit}</div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-semibold text-[#18243a]">{a.catalogItem?.name || '—'}</div>
                        <div className="text-xs text-[#8a96aa] font-mono">{a.catalogItem?.code}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 font-bold text-[#e74c3c]">¥{a.quotedPrice ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: st.color, backgroundColor: st.bg }}>{st.label}</span>
                    {a.status === 'COUNTERED' && a.counterPrice != null && (
                      <div className="mt-1 text-xs text-[#d97706]">反报价 ¥{a.counterPrice}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[#5a6d8a]">{new Date(a.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => { setSelected(a); }}
                      disabled={!['PENDING'].includes(a.status)}
                      className="px-3 py-1 text-xs text-white bg-[#064ea2] hover:bg-[#043d82] rounded transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {['PENDING'].includes(a.status) ? '审核' : '查看'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <ReviewModal
          application={selected}
          onClose={() => setSelected(null)}
          onSuccess={() => { setSelected(null); loadList(); }}
        />
      )}
    </div>
  );
}

function ReviewModal({
  application: a,
  onClose,
  onSuccess,
}: {
  application: CatalogApplication;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState('');
  const [counterPrice, setCounterPrice] = useState<string>('');
  const [counterNote, setCounterNote] = useState('');
  const [finalPrice, setFinalPrice] = useState<string>(String(a.quotedPrice ?? ''));
  const [referencePrice, setReferencePrice] = useState<string>('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isNewItem = a.type === 'NEW_ITEM';
  const ty = typeMap[a.type];

  async function submit() {
    setError('');
    if (action === 'reject' || action === 'return') {
      if (!reason.trim()) { setError('请填写' + (action === 'reject' ? '拒绝' : '退回') + '理由'); return; }
    }
    if (action === 'counter') {
      if (!counterPrice || Number(counterPrice) <= 0) { setError('请填写有效的议价反报价'); return; }
    }
    if (action === 'approve' && isNewItem) {
      if (!referencePrice || Number(referencePrice) <= 0) { setError('新增品类通过需填写官方参考价'); return; }
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'reject' || action === 'return') body.reason = reason.trim();
      if (action === 'counter') { body.counterPrice = Number(counterPrice); body.counterNote = counterNote.trim(); }
      if (action === 'approve') {
        if (finalPrice && Number(finalPrice) > 0) body.finalPrice = Number(finalPrice);
        if (isNewItem) {
          body.referencePrice = Number(referencePrice);
          if (priceMin) body.priceMin = Number(priceMin);
          if (priceMax) body.priceMax = Number(priceMax);
        }
      }
      if (reviewerNote.trim()) body.reviewerNote = reviewerNote.trim();
      await reviewCatalogApplication(a.id, body as any);
      onSuccess();
    } catch (e: any) {
      setError(e?.message || '操作失败');
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e5ecf4] flex items-center justify-between sticky top-0 bg-white">
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: ty.color, backgroundColor: ty.bg }}>{ty.label}</span>
            <h3 className="text-lg font-bold text-[#18243a]">供货申请审核</h3>
          </div>
          <button onClick={onClose} className="text-[#8a96aa] hover:text-[#18243a] text-xl px-2">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 供应商与物资 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-[#8a96aa] mb-1">申请供应商</div>
              <div className="font-semibold text-[#18243a]">{a.supplier?.name}</div>
            </div>
            <div>
              <div className="text-xs text-[#8a96aa] mb-1">目标物资</div>
              <div className="font-semibold text-[#18243a]">
                {isNewItem ? a.proposedName : a.catalogItem?.name}
              </div>
              <div className="text-xs text-[#8a96aa] mt-0.5">
                {isNewItem
                  ? `${a.proposedGroup} / ${a.proposedCategory} · ${a.proposedSpec || ''} · ${a.proposedUnit}`
                  : `${a.catalogItem?.code} · ${a.catalogItem?.specification} · ${a.catalogItem?.unit}`}
              </div>
            </div>
          </div>

          {/* 报价与供货条件 */}
          <div className="bg-[#f8fafc] rounded-xl p-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-[#8a96aa]">报价</div>
              <div className="text-lg font-bold text-[#e74c3c]">¥{a.quotedPrice}<span className="text-xs text-[#8a96aa] font-normal"> / {isNewItem ? a.proposedUnit : a.catalogItem?.unit}</span></div>
            </div>
            {a.deliveryPeriod && <div><div className="text-xs text-[#8a96aa]">交货周期</div><div className="text-[#18243a]">{a.deliveryPeriod}</div></div>}
            {a.region && <div><div className="text-xs text-[#8a96aa]">区域</div><div className="text-[#18243a]">{a.region}</div></div>}
            {a.minOrder && <div><div className="text-xs text-[#8a96aa]">最小起订</div><div className="text-[#18243a]">{a.minOrder}</div></div>}
            <div><div className="text-xs text-[#8a96aa]">含税/运费</div><div className="text-[#18243a]">{a.taxIncluded ? '含税' : '不含税'} · {a.freightIncluded ? '含运费' : '不含运费'}</div></div>
          </div>

          {/* 议价信息 */}
          {a.status === 'COUNTERED' && a.counterPrice != null && (
            <div className="bg-[#fffbeb] border border-[#fde68a] rounded-xl p-4 text-sm">
              <div className="font-semibold text-[#92400e]">已发出议价反报价 ¥{a.counterPrice}</div>
              {a.counterNote && <div className="text-[#a16207] mt-1">{a.counterNote}</div>}
              <div className="text-xs text-[#a16207] mt-2">提示：该申请当前为「议价中」，供应商接受或再报价后将回到「待审核」。</div>
            </div>
          )}

          {/* 资质说明 */}
          {a.qualificationNote && (
            <div>
              <div className="text-xs text-[#8a96aa] mb-1">资质说明</div>
              <div className="text-sm text-[#344563] bg-[#f8fafc] rounded-lg p-3 leading-relaxed">{a.qualificationNote}</div>
            </div>
          )}

          {/* 历史审核信息 */}
          {(a.rejectReason || a.reviewerNote) && (
            <div className="border border-[#e5ecf4] rounded-xl p-3 text-sm space-y-1">
              {a.rejectReason && <div className="text-[#e74c3c]">理由：{a.rejectReason}</div>}
              {a.reviewerNote && <div className="text-[#5a6d8a]">备注：{a.reviewerNote}</div>}
            </div>
          )}

          {/* 审核操作区（仅 PENDING 可操作）*/}
          {a.status === 'PENDING' ? (
            <div className="border-t border-[#e5ecf4] pt-4">
              <div className="text-sm font-bold text-[#18243a] mb-3">审核操作</div>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {([
                  { key: 'approve', label: '通过', color: 'bg-[#11a874]' },
                  { key: 'counter', label: '议价', color: 'bg-[#d97706]' },
                  { key: 'return', label: '退回', color: 'bg-[#f5a623]' },
                  { key: 'reject', label: '拒绝', color: 'bg-[#e74c3c]' },
                ] as const).map(b => (
                  <button
                    key={b.key}
                    onClick={() => { setAction(b.key); setError(''); }}
                    className={`py-2 text-sm font-semibold rounded-lg transition ${action === b.key ? b.color + ' text-white' : 'bg-[#f3f7fc] text-[#5a6d8a] hover:bg-[#e8eef6]'}`}
                  >{b.label}</button>
                ))}
              </div>

              {/* 动态表单 */}
              {action === 'approve' && (
                <div className="space-y-3 bg-[#f8fafc] rounded-xl p-4">
                  {isNewItem && (
                    <div className="bg-[#f0f6ff] border border-[#bbd7f5] rounded-lg p-3 text-xs text-[#064ea2]">
                      新增品类通过时，需设定官方参考价（写入采购目录）。供应商报价 ¥{a.quotedPrice} 作为其供货价。
                    </div>
                  )}
                  {isNewItem && (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-[#5a6d8a] font-semibold">官方参考价 *</label>
                          <input type="number" value={referencePrice} onChange={e => setReferencePrice(e.target.value)} placeholder="必填" className="w-full mt-1 px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
                        </div>
                        <div>
                          <label className="text-xs text-[#5a6d8a] font-semibold">价格下限</label>
                          <input type="number" value={priceMin} onChange={e => setPriceMin(e.target.value)} placeholder="可选" className="w-full mt-1 px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
                        </div>
                        <div>
                          <label className="text-xs text-[#5a6d8a] font-semibold">价格上限</label>
                          <input type="number" value={priceMax} onChange={e => setPriceMax(e.target.value)} placeholder="可选" className="w-full mt-1 px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
                        </div>
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-xs text-[#5a6d8a] font-semibold">最终供货报价（可改价后通过）</label>
                    <input type="number" value={finalPrice} onChange={e => setFinalPrice(e.target.value)} className="w-full mt-1 px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
                  </div>
                </div>
              )}

              {action === 'counter' && (
                <div className="space-y-3 bg-[#fffbeb] rounded-xl p-4">
                  <div>
                    <label className="text-xs text-[#92400e] font-semibold">议价反报价 *</label>
                    <input type="number" value={counterPrice} onChange={e => setCounterPrice(e.target.value)} placeholder="向供应商提出的反报价" className="w-full mt-1 px-3 py-2 border border-[#fde68a] rounded-lg text-sm focus:outline-none focus:border-[#d97706]" />
                  </div>
                  <textarea value={counterNote} onChange={e => setCounterNote(e.target.value)} placeholder="议价说明（可选）" className="w-full px-3 py-2 border border-[#fde68a] rounded-lg text-sm h-16 resize-none focus:outline-none focus:border-[#d97706]" />
                </div>
              )}

              {(action === 'reject' || action === 'return') && (
                <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={action === 'reject' ? '请填写拒绝理由（供应商可见）' : '请填写退回补正说明（供应商可见）'} className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm h-20 resize-none focus:outline-none focus:border-[#064ea2]" />
              )}

              {action && (
                <div className="mt-3">
                  <input value={reviewerNote} onChange={e => setReviewerNote(e.target.value)} placeholder="审核备注（可选，内部记录）" className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
                </div>
              )}

              {error && <div className="mt-3 text-sm text-[#e74c3c]">{error}</div>}
            </div>
          ) : (
            <div className="border-t border-[#e5ecf4] pt-4 text-center text-sm text-[#8a96aa]">
              该申请当前状态为「{statusMap[a.status]?.label}」，无需审核操作。
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e5ecf4] flex justify-end gap-3 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">关闭</button>
          {a.status === 'PENDING' && (
            <button
              onClick={submit}
              disabled={!action || submitting}
              className="px-5 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#043d82] rounded-lg transition disabled:opacity-50"
            >
              {submitting ? '处理中...' : '确认' + (action ? `「${({ approve: '通过', counter: '议价', return: '退回', reject: '拒绝' } as any)[action]}」` : '')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
