'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupplier, getSupplierChanges, getSupplierEvaluations, getQualifications, approveChange, rejectChange } from '@/lib/api/supplier';
import type { Supplier, SupplierChangeRecord, SupplierEvaluation, SupplierQualification } from '@/lib/types';

type TabKey = 'info' | 'contacts' | 'qualifications' | 'evaluations' | 'changes';

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待审核', color: '#f5a623', bg: '#f5a62318' },
  RETURNED: { label: '退回补正', color: '#e67e22', bg: '#e67e2218' },
  APPROVED: { label: '已入库', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '审核不通过', color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED: { label: '已停用', color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST: { label: '黑名单', color: '#c0392b', bg: '#c0392b18' },
};

const changeStatusMap: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待审核', color: '#f5a623', bg: '#f5a62318' },
  APPROVED: { label: '已通过', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '已拒绝', color: '#e74c3c', bg: '#e74c3c18' },
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [qualifications, setQualifications] = useState<SupplierQualification[]>([]);
  const [evaluations, setEvaluations] = useState<SupplierEvaluation[]>([]);
  const [changes, setChanges] = useState<SupplierChangeRecord[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const [loading, setLoading] = useState(true);

  // 变更审核弹窗
  const [reviewModal, setReviewModal] = useState<{ changeId: string; type: 'approve' | 'reject' } | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      getSupplier(id).catch(() => null),
      getQualifications(id).catch(() => []),
      getSupplierEvaluations(id).catch(() => []),
      getSupplierChanges(id).catch(() => []),
    ]).then(([s, q, e, c]) => {
      setSupplier(s);
      setQualifications(q);
      setEvaluations(e);
      setChanges(c);
      setLoading(false);
    });
  }, [id]);

  const handleReviewChange = async () => {
    if (!reviewModal) return;
    setReviewLoading(true);
    try {
      if (reviewModal.type === 'approve') await approveChange(reviewModal.changeId);
      else await rejectChange(reviewModal.changeId, reviewReason);
      setReviewModal(null);
      setReviewReason('');
      // 刷新变更列表
      getSupplierChanges(id).then(setChanges).catch(() => {});
      getSupplier(id).then(setSupplier).catch(() => {});
    } catch { /* empty */ }
    setReviewLoading(false);
  };

  if (loading) return <div className="text-[#5a6d8a] py-20 text-center">加载中...</div>;
  if (!supplier) return <div className="text-[#e74c3c] py-20 text-center">供应商不存在</div>;

  const st = statusMap[supplier.status] || { label: supplier.status, color: '#999', bg: '#99918' };

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'info', label: '基本信息' },
    { key: 'contacts', label: '联系人', count: supplier.contacts?.length },
    { key: 'qualifications', label: '资质材料', count: qualifications.length },
    { key: 'evaluations', label: '评价记录', count: evaluations.length },
    { key: 'changes', label: '变更记录', count: changes.length },
  ];

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/supplier')} className="text-[#5a6d8a] hover:text-[#064ea2] transition text-lg">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[#18243a]">{supplier.name}</h1>
            <span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: st.color, backgroundColor: st.bg }}>{st.label}</span>
          </div>
          <p className="text-sm text-[#5a6d8a] mt-1">统一社会信用代码：{supplier.creditCode}</p>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex border-b border-[#e8f0fa] mb-6">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-3 text-sm font-semibold transition border-b-2 -mb-px ${
              activeTab === tab.key ? 'text-[#064ea2] border-[#064ea2]' : 'text-[#5a6d8a] border-transparent hover:text-[#18243a]'
            }`}>
            {tab.label}{tab.count !== undefined && <span className="ml-1 text-xs opacity-60">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="bg-white rounded-xl border border-[#e8f0fa] p-6">
        {/* 基本信息 */}
        {activeTab === 'info' && (
          <div className="grid grid-cols-2 gap-x-12 gap-y-4">
            {[
              ['企业名称', supplier.name],
              ['统一社会信用代码', supplier.creditCode],
              ['企业类型', supplier.enterpriseType],
              ['法定代表人', supplier.legalPerson],
              ['注册地址', supplier.registeredAddress],
              ['经营范围', supplier.businessScope],
              ['分类', supplier.classification?.name || '未分类'],
              ['注册时间', new Date(supplier.createdAt).toLocaleString('zh-CN')],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-xs text-[#5a6d8a] mb-1">{label}</p>
                <p className="text-sm font-semibold text-[#18243a]">{value}</p>
              </div>
            ))}
            {supplier.returnReason && (
              <div className="col-span-2 mt-2 p-3 bg-[#f5a62312] rounded-lg border border-[#f5a62330]">
                <p className="text-xs text-[#f5a623] font-semibold mb-1">退回原因</p>
                <p className="text-sm text-[#18243a]">{supplier.returnReason}</p>
              </div>
            )}
            {supplier.rejectReason && (
              <div className="col-span-2 mt-2 p-3 bg-[#e74c3c12] rounded-lg border border-[#e74c3c30]">
                <p className="text-xs text-[#e74c3c] font-semibold mb-1">拒绝原因</p>
                <p className="text-sm text-[#18243a]">{supplier.rejectReason}</p>
              </div>
            )}
          </div>
        )}

        {/* 联系人 */}
        {activeTab === 'contacts' && (
          <div>
            {(!supplier.contacts || supplier.contacts.length === 0) ? (
              <p className="text-[#5a6d8a] text-center py-8">暂无联系人信息</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]">
                    <th className="pb-3">姓名</th><th className="pb-3">手机号</th><th className="pb-3">邮箱</th><th className="pb-3">类型</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.contacts.map(c => (
                    <tr key={c.id} className="border-b border-[#e8f0fa]">
                      <td className="py-3 font-semibold text-[#18243a]">{c.name}</td>
                      <td className="py-3 text-[#5a6d8a]">{c.phone}</td>
                      <td className="py-3 text-[#5a6d8a]">{c.email || '—'}</td>
                      <td className="py-3">{c.isPrimary ? <span className="px-2 py-0.5 text-xs bg-[#064ea218] text-[#064ea2] rounded">主要联系人</span> : '普通联系人'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 资质材料 */}
        {activeTab === 'qualifications' && (
          <div>
            {qualifications.length === 0 ? (
              <p className="text-[#5a6d8a] text-center py-8">暂无资质材料</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {qualifications.map(q => (
                  <div key={q.id} className="border border-[#e8f0fa] rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className="px-2 py-0.5 text-xs bg-[#064ea212] text-[#064ea2] rounded">{q.type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        q.status === '已过期' ? 'bg-[#e74c3c18] text-[#e74c3c]' :
                        q.status === '即将过期' ? 'bg-[#f5a62318] text-[#f5a623]' :
                        'bg-[#11a87418] text-[#11a874]'
                      }`}>{q.status || '有效'}</span>
                    </div>
                    <p className="font-semibold text-[#18243a] text-sm mb-1">{q.name}</p>
                    <p className="text-xs text-[#5a6d8a]">
                      有效期：{q.validFrom ? new Date(q.validFrom).toLocaleDateString('zh-CN') : '—'} ~ {q.validTo ? new Date(q.validTo).toLocaleDateString('zh-CN') : '长期'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 评价记录 */}
        {activeTab === 'evaluations' && (
          <div>
            {evaluations.length === 0 ? (
              <p className="text-[#5a6d8a] text-center py-8">暂无评价记录</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]">
                    <th className="pb-3">评分</th><th className="pb-3">等级</th><th className="pb-3">评价人</th><th className="pb-3">评价时间</th><th className="pb-3">意见</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map(e => (
                    <tr key={e.id} className="border-b border-[#e8f0fa]">
                      <td className="py-3 font-bold text-[#18243a]">{e.score}分</td>
                      <td className="py-3">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                          e.level === 'A' ? 'bg-[#11a87418] text-[#11a874]' :
                          e.level === 'B' ? 'bg-[#064ea218] text-[#064ea2]' :
                          e.level === 'C' ? 'bg-[#f5a62318] text-[#f5a623]' :
                          'bg-[#e74c3c18] text-[#e74c3c]'
                        }`}>{e.level}</span>
                      </td>
                      <td className="py-3 text-[#5a6d8a]">{e.evaluator?.displayName || '—'}</td>
                      <td className="py-3 text-[#5a6d8a]">{new Date(e.createdAt).toLocaleDateString('zh-CN')}</td>
                      <td className="py-3 text-[#5a6d8a] max-w-[200px] truncate">{e.comment || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 变更记录 */}
        {activeTab === 'changes' && (
          <div>
            {changes.length === 0 ? (
              <p className="text-[#5a6d8a] text-center py-8">暂无变更记录</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]">
                    <th className="pb-3">变更字段</th><th className="pb-3">原值</th><th className="pb-3">新值</th><th className="pb-3">状态</th><th className="pb-3">变更时间</th><th className="pb-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(c => {
                    const cs = changeStatusMap[c.status] || { label: c.status, color: '#999', bg: '#99918' };
                    return (
                      <tr key={c.id} className="border-b border-[#e8f0fa]">
                        <td className="py-3 font-semibold text-[#18243a]">{c.fieldLabel}</td>
                        <td className="py-3 text-[#5a6d8a] max-w-[150px] truncate">{c.oldValue || '—'}</td>
                        <td className="py-3 text-[#064ea2] max-w-[150px] truncate">{c.newValue || '—'}</td>
                        <td className="py-3"><span className="px-2 py-0.5 text-xs font-semibold rounded" style={{ color: cs.color, backgroundColor: cs.bg }}>{cs.label}</span></td>
                        <td className="py-3 text-[#5a6d8a]">{new Date(c.createdAt).toLocaleDateString('zh-CN')}</td>
                        <td className="py-3 text-right">
                          {c.status === 'PENDING' && (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'approve' }); }}
                                className="px-2 py-1 text-xs text-[#11a874] hover:bg-[#11a87412] rounded transition">通过</button>
                              <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'reject' }); }}
                                className="px-2 py-1 text-xs text-[#e74c3c] hover:bg-[#e74c3c12] rounded transition">拒绝</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 变更审核弹窗 */}
      {reviewModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setReviewModal(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#18243a] mb-4">
              {reviewModal.type === 'approve' ? '确认通过变更' : '拒绝变更'}
            </h3>
            {reviewModal.type === 'reject' && (
              <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)}
                placeholder="请填写拒绝原因..." className="w-full px-3 py-2 border border-[#e8f0fa] rounded-lg text-sm mb-4 h-24 resize-none focus:outline-none focus:border-[#064ea2]" />
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setReviewModal(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fbff] rounded-lg transition">取消</button>
              <button onClick={handleReviewChange} disabled={reviewLoading || (reviewModal.type === 'reject' && !reviewReason.trim())}
                className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${reviewModal.type === 'approve' ? 'bg-[#11a874] hover:bg-[#0e8c5f]' : 'bg-[#e74c3c] hover:bg-[#c0392b]'}`}>
                {reviewLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
