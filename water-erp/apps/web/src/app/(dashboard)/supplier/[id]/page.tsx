'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplier, getSupplierChanges, getSupplierEvaluations, getQualifications, approveChange, rejectChange, approveSupplier, rejectSupplier, returnSupplier, updateSupplierStatus, getClassifications } from '@/lib/api/supplier';
import type { Supplier, SupplierChangeRecord, SupplierEvaluation, SupplierQualification, SupplierClassification } from '@/lib/types';

type TabKey = 'info' | 'contacts' | 'qualifications' | 'evaluations' | 'changes';

/* ── 统一状态色板 ── */
const statusColor: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:   { label: '待审核',     color: '#f5a623', bg: '#f5a62318' },
  RETURNED:  { label: '退回补正',   color: '#e67e22', bg: '#e67e2218' },
  APPROVED:  { label: '已入库',     color: '#11a874', bg: '#11a87418' },
  REJECTED:  { label: '审核不通过', color: '#e74c3c', bg: '#e74c3c18' },
  DISABLED:  { label: '已停用',     color: '#95a5a6', bg: '#95a5a618' },
  BLACKLIST: { label: '黑名单',     color: '#c0392b', bg: '#c0392b18' },
};

const changeStatusColor: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:  { label: '待审批', color: '#f5a623', bg: '#f5a62318' },
  APPROVED: { label: '已通过', color: '#11a874', bg: '#11a87418' },
  REJECTED: { label: '已拒绝', color: '#e74c3c', bg: '#e74c3c18' },
};

const levelColor: Record<string, { color: string; bg: string; label: string }> = {
  A: { label: '优秀', color: '#11a874', bg: '#11a87418' },
  B: { label: '良好', color: '#064ea2', bg: '#064ea218' },
  C: { label: '合格', color: '#f5a623', bg: '#f5a62318' },
  D: { label: '不合格', color: '#e74c3c', bg: '#e74c3c18' },
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

  // 状态操作弹窗
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject' | 'return' | 'disable' | 'blacklist'; supplier: Supplier } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // 分类分配弹窗
  const [classModal, setClassModal] = useState(false);
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classLoading, setClassLoading] = useState(false);

  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    const [s, q, e, c] = await Promise.all([
      getSupplier(id).catch(() => null),
      getQualifications(id).catch(() => []),
      getSupplierEvaluations(id).catch(() => []),
      getSupplierChanges(id).catch(() => []),
    ]);
    setSupplier(s);
    setQualifications(q);
    setEvaluations(e);
    setChanges(c);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [id]);
  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); }, []);

  const handleReviewChange = async () => {
    if (!reviewModal) return;
    setReviewLoading(true);
    try {
      if (reviewModal.type === 'approve') await approveChange(reviewModal.changeId);
      else await rejectChange(reviewModal.changeId, reviewReason);
      toast.success(reviewModal.type === 'approve' ? '变更已通过' : '变更已拒绝');
      setReviewModal(null);
      setReviewReason('');
      loadAll();
    } catch { toast.error('操作失败'); }
    setReviewLoading(false);
  };

  const handleAction = async () => {
    if (!actionModal) return;
    setActionLoading(true);
    try {
      const { type, supplier: s } = actionModal;
      if (type === 'approve') await approveSupplier(s.id);
      else if (type === 'reject') await rejectSupplier(s.id, actionReason);
      else if (type === 'return') await returnSupplier(s.id, actionReason);
      else if (type === 'disable') await updateSupplierStatus(s.id, 'DISABLED', actionReason);
      else if (type === 'blacklist') await updateSupplierStatus(s.id, 'BLACKLIST', actionReason);
      toast.success('操作成功');
      setActionModal(null);
      setActionReason('');
      loadAll();
    } catch { toast.error('操作失败'); }
    setActionLoading(false);
  };

  const handleAssignClass = async () => {
    if (!selectedClassId || !supplier) return;
    setClassLoading(true);
    try {
      // 更新供应商分类 — 后端 PATCH /supplier/:id/classification
      await fetch(`/api/supplier/${supplier.id}/classification`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classificationId: selectedClassId }),
      });
      toast.success('分类已更新');
      setClassModal(false);
      loadAll();
    } catch { toast.error('分类更新失败'); }
    setClassLoading(false);
  };

  if (loading) return <div className="text-[#5a6d8a] py-20 text-center text-sm">加载中...</div>;
  if (!supplier) return <div className="text-[#e74c3c] py-20 text-center">供应商不存在</div>;

  const st = statusColor[supplier.status] || { label: supplier.status, color: '#999', bg: '#99918' };

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'info', label: '基本信息' },
    { key: 'contacts', label: '联系人', count: supplier.contacts?.length },
    { key: 'qualifications', label: '资质材料', count: qualifications.length },
    { key: 'evaluations', label: '履约评价', count: evaluations.length },
    { key: 'changes', label: '变更记录', count: changes.length },
  ];

  /* ── 资质到期判定 ── */
  const getQualStatus = (q: SupplierQualification) => {
    if (!q.validTo) return { label: '长期有效', color: '#11a874', bg: '#11a87418' };
    const end = new Date(q.validTo);
    const now = new Date();
    const diffDays = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return { label: '已过期', color: '#e74c3c', bg: '#e74c3c18' };
    if (diffDays < 90) return { label: '即将到期', color: '#f5a623', bg: '#f5a62318' };
    return { label: '有效', color: '#11a874', bg: '#11a87418' };
  };

  /* ── 计算综合评价 ── */
  const avgScore = evaluations.length > 0
    ? (evaluations.reduce((s, e) => s + e.overallScore, 0) / evaluations.length).toFixed(1)
    : null;

  return (
    <div>
      {/* ═══ 顶部品牌横幅 ═══ */}
      <div className="bg-gradient-to-r from-[#064ea2] to-[#0891b2] rounded-xl p-5 mb-6 text-white flex items-center gap-5">
        <img src="/assets/logo.jpg" alt="智慧水发 · 蜀水云采" className="w-12 h-12 rounded-xl object-cover border-2 border-white/30 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{supplier.name}</h1>
            <span className="px-2.5 py-1 rounded text-xs font-semibold" style={{ color: st.color, backgroundColor: st.bg }}>{st.label}</span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-white/70">
            <span>信用代码：{supplier.creditCode}</span>
            <span>·</span>
            <span>分类：{supplier.classification?.name || '未分类'}</span>
            {avgScore && <><span>·</span><span>综合评分：{avgScore}</span></>}
          </div>
        </div>
        {/* 快捷操作 */}
        <div className="flex gap-2 flex-shrink-0">
          {(supplier.status === 'PENDING' || supplier.status === 'RETURNED') && (
            <>
              <button onClick={() => setActionModal({ type: 'approve', supplier })} className="px-4 py-2 bg-white/20 text-white rounded-lg text-sm font-semibold hover:bg-white/30 transition">通过审核</button>
              <button onClick={() => { setActionReason(''); setActionModal({ type: 'return', supplier }); }} className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">退回补正</button>
              <button onClick={() => { setActionReason(''); setActionModal({ type: 'reject', supplier }); }} className="px-4 py-2 bg-[#e74c3c]/80 text-white rounded-lg text-sm font-semibold hover:bg-[#e74c3c] transition">拒绝</button>
            </>
          )}
          {supplier.status === 'APPROVED' && (
            <>
              <button onClick={() => { setSelectedClassId(supplier.classificationId || ''); setClassModal(true); }} className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">分配分类</button>
              <button onClick={() => { setActionReason(''); setActionModal({ type: 'disable', supplier }); }} className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">停用</button>
              <button onClick={() => { setActionReason(''); setActionModal({ type: 'blacklist', supplier }); }} className="px-4 py-2 bg-[#e74c3c]/80 text-white rounded-lg text-sm font-semibold hover:bg-[#e74c3c] transition">黑名单</button>
            </>
          )}
          <button onClick={() => router.push('/supplier')} className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">← 返回列表</button>
        </div>
      </div>

      {/* ═══ Tab 导航 ═══ */}
      <div className="flex border-b border-[#e5ecf4] mb-6">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-3 text-sm font-semibold transition border-b-2 -mb-px ${
              activeTab === tab.key ? 'text-[#064ea2] border-[#064ea2]' : 'text-[#5a6d8a] border-transparent hover:text-[#18243a]'
            }`}>
            {tab.label}{tab.count !== undefined && <span className="ml-1.5 text-xs opacity-50">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* ═══ Tab 内容 ═══ */}
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-6">
        {/* ── 基本信息 ── */}
        {activeTab === 'info' && (
          <div>
            <div className="grid grid-cols-3 gap-x-10 gap-y-5">
              {[
                ['企业名称', supplier.name],
                ['统一社会信用代码', supplier.creditCode],
                ['企业类型', supplier.enterpriseType],
                ['法定代表人', supplier.legalPerson],
                ['注册地址', supplier.registeredAddress || '—'],
                ['经营范围', supplier.businessScope || '—'],
                ['分类', supplier.classification?.name || '未分类'],
                ['注册时间', new Date(supplier.createdAt).toLocaleDateString('zh-CN')],
                ['更新时间', new Date(supplier.updatedAt).toLocaleDateString('zh-CN')],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-xs text-[#8a96aa] mb-1">{label}</p>
                  <p className="text-sm font-semibold text-[#18243a]">{value}</p>
                </div>
              ))}
            </div>
            {supplier.returnReason && (
              <div className="mt-5 p-4 bg-[#f5a62310] rounded-xl border border-[#f5a62330] flex items-start gap-3">
                <span className="text-lg">⚠️</span>
                <div>
                  <p className="text-xs text-[#f5a623] font-semibold mb-1">退回补正原因</p>
                  <p className="text-sm text-[#18243a]">{supplier.returnReason}</p>
                </div>
              </div>
            )}
            {supplier.rejectReason && (
              <div className="mt-5 p-4 bg-[#e74c3c10] rounded-xl border border-[#e74c3c30] flex items-start gap-3">
                <span className="text-lg">❌</span>
                <div>
                  <p className="text-xs text-[#e74c3c] font-semibold mb-1">审核不通过原因</p>
                  <p className="text-sm text-[#18243a]">{supplier.rejectReason}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 联系人 ── */}
        {activeTab === 'contacts' && (
          <div>
            {(!supplier.contacts || supplier.contacts.length === 0) ? (
              <p className="text-[#8a96aa] text-center py-10">暂无联系人信息</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
                    <th className="pb-3 px-4">姓名</th><th className="pb-3 px-4">手机号</th><th className="pb-3 px-4">邮箱</th><th className="pb-3 px-4">类型</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.contacts.map(c => (
                    <tr key={c.id} className="border-b border-[#e5ecf4] hover:bg-[#f7f9fc]">
                      <td className="py-3 px-4 font-semibold text-[#18243a]">{c.name}</td>
                      <td className="py-3 px-4 text-[#5a6d8a] font-mono text-xs">{c.phone}</td>
                      <td className="py-3 px-4 text-[#5a6d8a]">{c.email || '—'}</td>
                      <td className="py-3 px-4">
                        {c.isPrimary
                          ? <span className="px-2.5 py-1 text-xs bg-[#064ea218] text-[#064ea2] rounded font-semibold">主要联系人</span>
                          : <span className="text-[#8a96aa] text-xs">普通联系人</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── 资质材料 ── */}
        {activeTab === 'qualifications' && (
          <div>
            {qualifications.length === 0 ? (
              <p className="text-[#8a96aa] text-center py-10">暂无资质材料</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {qualifications.map(q => {
                  const qs = getQualStatus(q);
                  return (
                    <div key={q.id} className="border border-[#e5ecf4] rounded-xl p-5 hover:shadow-sm transition">
                      <div className="flex justify-between items-center mb-3">
                        <span className="px-2.5 py-1 text-xs bg-[#064ea212] text-[#064ea2] rounded font-semibold">{q.type}</span>
                        <span className="text-xs px-2.5 py-1 rounded font-semibold" style={{ color: qs.color, backgroundColor: qs.bg }}>{qs.label}</span>
                      </div>
                      <p className="font-bold text-[#18243a] text-sm mb-2">{q.name}</p>
                      <p className="text-xs text-[#8a96aa]">
                        有效期：{q.validFrom ? new Date(q.validFrom).toLocaleDateString('zh-CN') : '—'} ~ {q.validTo ? new Date(q.validTo).toLocaleDateString('zh-CN') : '长期'}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 履约评价 ── */}
        {activeTab === 'evaluations' && (
          <div>
            {evaluations.length === 0 ? (
              <p className="text-[#8a96aa] text-center py-10">暂无履约评价记录</p>
            ) : (
              <>
                {/* 评价概要卡片 */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  {[
                    { label: '评价次数', value: evaluations.length, color: '#064ea2' },
                    { label: '平均分', value: avgScore || '—', color: '#11a874' },
                    { label: '最高等级', value: evaluations.reduce((best, e) => e.level < best ? e.level : best, 'D'), color: '#f5a623' },
                    { label: '最近评价', value: evaluations[0] ? new Date(evaluations[0].createdAt).toLocaleDateString('zh-CN') : '—', color: '#5a6d8a' },
                  ].map(s => (
                    <div key={s.label} className="bg-[#f7f9fc] rounded-xl p-4">
                      <p className="text-xs text-[#8a96aa] mb-1">{s.label}</p>
                      <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
                      <th className="pb-3 px-4">评分</th><th className="pb-3 px-4">等级</th>
                      <th className="pb-3 px-4">完整性</th><th className="pb-3 px-4">响应性</th>
                      <th className="pb-3 px-4">合作度</th><th className="pb-3 px-4">合规性</th>
                      <th className="pb-3 px-4">评价人</th><th className="pb-3 px-4">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluations.map(e => {
                      const lc = levelColor[e.level] || levelColor.D;
                      return (
                        <tr key={e.id} className="border-b border-[#e5ecf4] hover:bg-[#f7f9fc]">
                          <td className="py-3 px-4 font-bold text-[#18243a]">{e.overallScore.toFixed(1)}</td>
                          <td className="py-3 px-4">
                            <span className="px-2.5 py-1 text-xs font-semibold rounded" style={{ color: lc.color, backgroundColor: lc.bg }}>{lc.label} ({e.level})</span>
                          </td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{e.completenessScore}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{e.responsivenessScore}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{e.cooperationScore}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{e.complianceScore}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{e.evaluator?.displayName || '—'}</td>
                          <td className="py-3 px-4 text-[#8a96aa]">{new Date(e.createdAt).toLocaleDateString('zh-CN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* ── 变更记录 ── */}
        {activeTab === 'changes' && (
          <div>
            {changes.length === 0 ? (
              <p className="text-[#8a96aa] text-center py-10">暂无变更记录</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
                    <th className="pb-3 px-4">变更字段</th><th className="pb-3 px-4">原值</th>
                    <th className="pb-3 px-4">新值</th><th className="pb-3 px-4">原因</th>
                    <th className="pb-3 px-4">状态</th><th className="pb-3 px-4">变更时间</th>
                    <th className="pb-3 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(c => {
                    const cs = changeStatusColor[c.status] || { label: c.status, color: '#999', bg: '#99918' };
                    return (
                      <tr key={c.id} className="border-b border-[#e5ecf4] hover:bg-[#f7f9fc]">
                        <td className="py-3 px-4 font-semibold text-[#18243a]">{c.fieldLabel}</td>
                        <td className="py-3 px-4 text-[#8a96aa] max-w-[150px] truncate">{c.oldValue || '—'}</td>
                        <td className="py-3 px-4 text-[#064ea2] font-medium max-w-[150px] truncate">{c.newValue || '—'}</td>
                        <td className="py-3 px-4 text-[#8a96aa] max-w-[150px] truncate">{c.reason || '—'}</td>
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-1 text-xs font-semibold rounded" style={{ color: cs.color, backgroundColor: cs.bg }}>{cs.label}</span>
                        </td>
                        <td className="py-3 px-4 text-[#8a96aa]">{new Date(c.createdAt).toLocaleDateString('zh-CN')}</td>
                        <td className="py-3 px-4 text-right">
                          {c.status === 'PENDING' && (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'approve' }); }}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#11a874] rounded-lg hover:bg-[#0e8c5f] transition">通过</button>
                              <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'reject' }); }}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#e74c3c] rounded-lg hover:bg-[#c0392b] transition">拒绝</button>
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

      {/* ═══ 状态操作弹窗 ═══ */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50" onClick={() => setActionModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <img src="/assets/logo.jpg" alt="" className="w-8 h-8 rounded-lg" />
              <h3 className="text-lg font-bold text-[#18243a]">
                {actionModal.type === 'approve' && '确认审核通过'}
                {actionModal.type === 'reject' && '审核不通过'}
                {actionModal.type === 'return' && '退回补正'}
                {actionModal.type === 'disable' && '停用供应商'}
                {actionModal.type === 'blacklist' && '加入黑名单'}
              </h3>
            </div>
            <p className="text-sm text-[#5a6d8a] mb-3">供应商：<strong className="text-[#18243a]">{actionModal.supplier.name}</strong></p>
            {actionModal.type !== 'approve' && (
              <textarea value={actionReason} onChange={e => setActionReason(e.target.value)}
                placeholder={actionModal.type === 'return' ? '请填写退回补正原因...' : '请填写原因...'}
                className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm mb-4 h-24 resize-none focus:outline-none focus:border-[#064ea2]" />
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f7f9fc] rounded-lg transition">取消</button>
              <button onClick={handleAction} disabled={actionLoading || (actionModal.type !== 'approve' && !actionReason.trim())}
                className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${
                  actionModal.type === 'approve' ? 'bg-[#11a874] hover:bg-[#0e8c5f]' :
                  actionModal.type === 'return' ? 'bg-[#f5a623] hover:bg-[#d9921e]' :
                  'bg-[#e74c3c] hover:bg-[#c0392b]'
                }`}>
                {actionLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 变更审核弹窗 ═══ */}
      {reviewModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50" onClick={() => setReviewModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <img src="/assets/logo.jpg" alt="" className="w-8 h-8 rounded-lg" />
              <h3 className="text-lg font-bold text-[#18243a]">
                {reviewModal.type === 'approve' ? '确认通过变更' : '拒绝变更'}
              </h3>
            </div>
            {reviewModal.type === 'reject' && (
              <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)}
                placeholder="请填写拒绝原因..."
                className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm mb-4 h-24 resize-none focus:outline-none focus:border-[#064ea2]" />
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setReviewModal(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f7f9fc] rounded-lg transition">取消</button>
              <button onClick={handleReviewChange} disabled={reviewLoading || (reviewModal.type === 'reject' && !reviewReason.trim())}
                className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${reviewModal.type === 'approve' ? 'bg-[#11a874] hover:bg-[#0e8c5f]' : 'bg-[#e74c3c] hover:bg-[#c0392b]'}`}>
                {reviewLoading ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 分类分配弹窗 ═══ */}
      {classModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50" onClick={() => setClassModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <img src="/assets/logo.jpg" alt="" className="w-8 h-8 rounded-lg" />
              <h3 className="text-lg font-bold text-[#18243a]">分配供应商分类</h3>
            </div>
            <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
              className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2] mb-4">
              <option value="">不分类</option>
              {classifications.map(c => <option key={c.id} value={c.id}>{c.name}（{c.code}）</option>)}
            </select>
            <div className="flex justify-end gap-3">
              <button onClick={() => setClassModal(false)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f7f9fc] rounded-lg transition">取消</button>
              <button onClick={handleAssignClass} disabled={classLoading}
                className="px-4 py-2 text-sm text-white bg-[#064ea2] rounded-lg hover:bg-[#0e62d0] disabled:opacity-50 transition">
                {classLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
