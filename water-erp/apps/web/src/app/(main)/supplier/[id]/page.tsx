'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplier, getSupplierChanges, getSupplierEvaluations, getQualifications, approveChange, rejectChange, approveSupplier, rejectSupplier, returnSupplier, updateSupplierStatus, getClassifications } from '@/lib/api/supplier';
import type { Supplier, SupplierChangeRecord, SupplierEvaluation, SupplierQualification, SupplierClassification } from '@/lib/types';
import { AlertBanner, type AlertSeverity, Breadcrumb } from '@/components/workbench';
import { useSupplierAlerts } from '@/lib/hooks/use-alerts';
import { CheckCircle2, XCircle, RotateCcw, FileCheck, Building2, ShieldCheck, Clock, Calendar, Award, FileText, User, MapPin, Phone, Mail, Hash } from 'lucide-react';

type TabKey = 'info' | 'contacts' | 'qualifications' | 'evaluations' | 'changes';

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

  // 审批操作（内联底部栏，仅 approve/reject/return）
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject' | 'return' | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [approvalLoading, setApprovalLoading] = useState(false);

  // 状态操作弹窗（停用/黑名单，保留 modal）
  const [actionModal, setActionModal] = useState<{ type: 'disable' | 'blacklist'; supplier: Supplier } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // 分类分配弹窗
  const [classModal, setClassModal] = useState(false);
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classLoading, setClassLoading] = useState(false);

  const closeApproval = () => { setApprovalMode(null); setApprovalReason(''); };

  const loadAll = useCallback(async () => {
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
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); }, []);

  const supplierAlerts = useSupplierAlerts(id as string);
  const alertItems = supplierAlerts.expiringQualifications.map((q) => {
    const severity: AlertSeverity = q.daysLeft < 0 || q.daysLeft < 7 ? 'red' : q.daysLeft < 30 ? 'orange' : 'orange-light';
    const prefix = q.daysLeft < 0 ? '已过期' : q.daysLeft < 7 ? '即将过期' : q.daysLeft < 30 ? '即将到期' : '注意到期';
    return { severity, title: `${prefix}：${q.name}`, detail: `有效期至 ${new Date(q.validTo).toLocaleDateString('zh-CN')}（${q.daysLeft < 0 ? '已过期' : `剩 ${q.daysLeft} 天`}）` };
  });

  // ── 变更审核 ──
  const handleReviewChange = async () => {
    if (!reviewModal) return;
    setReviewLoading(true);
    try {
      if (reviewModal.type === 'approve') await approveChange(reviewModal.changeId);
      else await rejectChange(reviewModal.changeId, reviewReason);
      toast.success(reviewModal.type === 'approve' ? '变更已通过' : '变更已拒绝');
      setReviewModal(null); setReviewReason(''); loadAll();
    } catch { toast.error('操作失败'); }
    setReviewLoading(false);
  };

  // ── 审批操作（乐观更新 + 撤销 toast）──
  const handleApproval = async () => {
    if (!supplier || !approvalMode) return;
    if (approvalMode !== 'approve' && !approvalReason.trim()) { toast.error('请填写原因'); return; }

    const label = approvalMode === 'approve' ? '已通过' : approvalMode === 'return' ? '已退回补正' : '已拒绝';
    const prevStatus = supplier.status as string;
    const prevReturn = supplier.returnReason;
    const prevReject = supplier.rejectReason;
    const newStatus = (approvalMode === 'approve' ? 'APPROVED' : approvalMode === 'return' ? 'RETURNED' : 'REJECTED') as Supplier['status'];

    // 乐观更新
    setSupplier(s => s ? { ...s, status: newStatus, returnReason: approvalMode === 'return' ? approvalReason : undefined, rejectReason: approvalMode === 'reject' ? approvalReason : undefined } : s);
    closeApproval();

    let cancelled = false;
    toast(`${label}「${supplier.name}」`, {
      description: '4 秒内可撤销',
      duration: 4000,
      action: { label: '撤销', onClick: () => { cancelled = true; setSupplier(s => s ? { ...s, status: prevStatus as Supplier['status'], returnReason: prevReturn, rejectReason: prevReject } : s); } },
    });

    await new Promise(r => setTimeout(r, 4200));
    if (cancelled) return;

    setApprovalLoading(true);
    try {
      if (approvalMode === 'approve') await approveSupplier(supplier.id);
      else if (approvalMode === 'reject') await rejectSupplier(supplier.id, approvalReason);
      else if (approvalMode === 'return') await returnSupplier(supplier.id, approvalReason);
      loadAll();
    } catch (e: any) { toast.error(e?.message || '操作失败'); loadAll(); }
    setApprovalLoading(false);
  };

  // ── 状态操作（停用/黑名单）──
  const handleStatusAction = async () => {
    if (!actionModal || !actionReason.trim()) { toast.error('请填写原因'); return; }
    setActionLoading(true);
    try {
      await updateSupplierStatus(actionModal.supplier.id, actionModal.type === 'disable' ? 'DISABLED' : 'BLACKLIST', actionReason);
      toast.success(actionModal.type === 'disable' ? '已停用' : '已加入黑名单');
      setActionModal(null); setActionReason(''); loadAll();
    } catch { toast.error('操作失败'); }
    setActionLoading(false);
  };

  // ── 分类分配 ──
  const handleAssignClass = async () => {
    if (!selectedClassId || !supplier) return;
    setClassLoading(true);
    try {
      await fetch(`/api/supplier/${supplier.id}/classification`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classificationId: selectedClassId }) });
      toast.success('分类已更新'); setClassModal(false); loadAll();
    } catch { toast.error('分类更新失败'); }
    setClassLoading(false);
  };

  if (loading) return (
    <div className="space-y-6 animate-pulse">
      <div className="h-20 rounded-xl bg-gradient-to-r from-[#e8eef5] to-[#dce4f0]" />
      <div className="flex gap-4 pb-2"><div className="skeleton h-9 w-20 rounded-lg" /><div className="skeleton h-9 w-20 rounded-lg" /><div className="skeleton h-9 w-20 rounded-lg" /></div>
      <div className="rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-3 gap-6">{Array.from({ length: 9 }).map((_, i) => <div key={i}><div className="skeleton h-3 w-16 mb-1" /><div className="skeleton h-5 w-32" /></div>)}</div>
      </div>
    </div>
  );
  if (!supplier) return <div className="text-[#e74c3c] py-20 text-center">供应商不存在</div>;

  const st = statusColor[supplier.status] || { label: supplier.status, color: '#999', bg: '#99918' };
  const isPending = supplier.status === 'PENDING' || supplier.status === 'RETURNED';
  const isRejected = supplier.status === 'REJECTED';
  const daysSinceReg = Math.floor((Date.now() - new Date(supplier.createdAt).getTime()) / (1000 * 60 * 60 * 24));

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'info', label: '基本信息' },
    { key: 'contacts', label: '联系人', count: supplier.contacts?.length },
    { key: 'qualifications', label: '资质材料', count: qualifications.length },
    { key: 'evaluations', label: '履约评价', count: evaluations.length },
    { key: 'changes', label: '变更记录', count: changes.length },
  ];

  const getQualStatus = (q: SupplierQualification) => {
    if (!q.validTo) return { label: '长期有效', color: '#11a874', bg: '#11a87418' };
    const end = new Date(q.validTo);
    const now = new Date();
    const diffDays = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return { label: '已过期', color: '#e74c3c', bg: '#e74c3c18' };
    if (diffDays < 90) return { label: '即将到期', color: '#f5a623', bg: '#f5a62318' };
    return { label: '有效', color: '#11a874', bg: '#11a87418' };
  };

  const avgScore = evaluations.length > 0
    ? (evaluations.reduce((s, e) => s + Number(e.overallScore), 0) / evaluations.length).toFixed(1)
    : null;

  const qualStats = {
    total: qualifications.length,
    valid: qualifications.filter(q => getQualStatus(q).label === '有效').length,
    expiring: qualifications.filter(q => getQualStatus(q).label === '即将到期').length,
    expired: qualifications.filter(q => getQualStatus(q).label === '已过期').length,
  };

  // ─── 评估等级分布 ───
  const evalLevelCounts = { A: 0, B: 0, C: 0, D: 0 };
  evaluations.forEach(e => { if (e.level in evalLevelCounts) evalLevelCounts[e.level as keyof typeof evalLevelCounts]++; });

  const primaryContact = supplier.contacts?.find(c => c.isPrimary);

  return (
    <div className={isPending ? 'pb-24' : ''}>
      <Breadcrumb items={[{ label: '供应商库', path: '/supplier/repository' }, { label: supplier?.name || '详情' }]} />

      {/* ═══════════════════════════════════════════════════
         顶部横幅 — 仅核心识别信息（详细字段移至基本信息Tab）
         ═══════════════════════════════════════════════════ */}
      <div className={`rounded-xl p-5 mb-5 flex items-start gap-5 ${
        isPending ? 'bg-gradient-to-r from-[#f5a623] to-[#e67e22]' :
        isRejected ? 'bg-gradient-to-r from-[#e74c3c] to-[#c0392b]' :
        'bg-gradient-to-r from-[#064ea2] to-[#0891b2]'
      }`}>

        {/* 左侧：首字母 + 核心信息 + 原因（如适用） */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-2xl font-black">{supplier.name[0]}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-white">{supplier.name}</h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border border-white/30 bg-white/15 text-white">{st.label}</span>
              {supplier.user?.isActive !== undefined && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${supplier.user.isActive ? 'bg-white/15 text-white border border-white/25' : 'bg-red-400/30 text-red-100 border border-red-300/30'}`}>
                  {supplier.user.isActive ? '账户已激活' : '账户未激活'}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-white/65 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><Hash size={11} />{supplier.creditCode || '信用代码未登记'}</span>
              {supplier.classification && <><span className="opacity-40">·</span><span>{supplier.classification.name}</span></>}
              {avgScore && <><span className="opacity-40">·</span><span>综合评分 {avgScore}</span></>}
              <span className="opacity-40">·</span><span>注册 {daysSinceReg} 天</span>
            </p>

            {/* 退回/不通过原因 — 内联到 banner，不单独占用卡片 */}
            {supplier.returnReason && supplier.status === 'RETURNED' && (
              <div className="mt-2 flex items-start gap-1.5 text-sm">
                <RotateCcw size={13} className="mt-0.5 flex-shrink-0 text-white/70" />
                <span className="text-white/85"><strong>退回原因：</strong>{supplier.returnReason}</span>
              </div>
            )}
            {supplier.rejectReason && (
              <div className="mt-2 flex items-start gap-1.5 text-sm">
                <XCircle size={13} className="mt-0.5 flex-shrink-0 text-white/70" />
                <span className="text-white/85"><strong>不通过原因：</strong>{supplier.rejectReason}</span>
              </div>
            )}
          </div>
        </div>

        {/* 右侧操作 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {supplier.status === 'APPROVED' && (
            <>
              <button onClick={() => { setSelectedClassId(supplier.classificationId || ''); setClassModal(true); }} className="btn-press px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">分配分类</button>
              <button onClick={() => { setActionReason(''); setActionModal({ type: 'disable', supplier }); }} className="btn-press px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">停用</button>
              <button onClick={() => { setActionReason(''); setActionModal({ type: 'blacklist', supplier }); }} className="btn-press px-4 py-2 bg-[#e74c3c]/80 text-white rounded-lg text-sm font-semibold hover:bg-[#e74c3c] transition">黑名单</button>
            </>
          )}
          <button onClick={() => router.push('/supplier')} className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold hover:bg-white/20 transition">← 返回列表</button>
        </div>
      </div>

      <div className="mb-4"><AlertBanner items={alertItems} /></div>

      {/* ═══════════════════════════════════════════════════
         审批进度卡片 — 合并原「审核摘要」+「状态时间线」+ 资质速览
         仅 PENDING / RETURNED 显示
         ═══════════════════════════════════════════════════ */}
      {isPending && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FileCheck size={15} className="text-[#f5a623]" />
            <span className="text-sm font-extrabold text-[#18243a]">审批进度</span>
            {supplier.status === 'RETURNED' && (
              <span className="ml-auto rounded-full bg-[#fef3c7] px-2.5 py-0.5 text-[11px] font-bold text-[#b45309]">补正中</span>
            )}
            {supplier.status === 'PENDING' && (
              <span className="ml-auto rounded-full bg-[#fef3c7] px-2.5 py-0.5 text-[11px] font-bold text-[#b45309]">待审核</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* 左：时间线 */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center pt-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#11a874] ring-2 ring-[#11a87420]" />
                  <div className="w-0.5 h-9 bg-[#e5ecf4]" />
                  <div className="w-3 h-3 rounded-full ring-2" style={{ backgroundColor: supplier.status === 'RETURNED' ? '#e67e22' : '#f5a623', boxShadow: `0 0 0 2px ${supplier.status === 'RETURNED' ? '#e67e2220' : '#f5a62320'}` }} />
                </div>
                <div className="space-y-3 flex-1 pb-1">
                  <div>
                    <p className="text-sm font-semibold text-[#18243a]">供应商注册申请</p>
                    <p className="text-xs text-[#8a96aa] mt-0.5">{new Date(supplier.createdAt).toLocaleDateString('zh-CN')} · 提交 {qualifications.length} 份资质材料</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: supplier.status === 'RETURNED' ? '#e67e22' : '#f5a623' }}>
                      {supplier.status === 'RETURNED' ? '退回补正' : '等待审核'}
                    </p>
                    <p className="text-xs text-[#8a96aa] mt-0.5">
                      {supplier.status === 'RETURNED'
                        ? `${new Date(supplier.updatedAt).toLocaleDateString('zh-CN')} 退回 · ${supplier.returnReason || '需补正材料后重新提交'}`
                        : '采购管理员审核中'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 中：关键摘要 */}
            <div className="space-y-2.5">
              {[
                { icon: Building2, label: '企业类型', value: supplier.enterpriseType },
                { icon: ShieldCheck, label: '法定代表人', value: supplier.legalPerson },
                { icon: MapPin, label: '注册地址', value: supplier.registeredAddress || '未登记' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <item.icon size={13} className="text-[#8a96aa] flex-shrink-0" />
                  <span className="text-xs text-[#8a96aa]">{item.label}：</span>
                  <span className="text-xs font-semibold text-[#18243a] truncate">{item.value}</span>
                </div>
              ))}
            </div>

            {/* 右：联系人与账户 */}
            <div className="space-y-2.5">
              {((
                [primaryContact && { icon: User, label: '主要联系人', value: `${primaryContact.name}${primaryContact.phone ? ' · ' + primaryContact.phone : ''}` },
                { icon: Mail, label: '注册邮箱', value: supplier.user?.email || '未登记' },
                { icon: Calendar, label: '用户名', value: supplier.user?.username || '—' },
              ] as { icon: React.ComponentType<{ size?: number }>; label: string; value: string }[]).filter(Boolean).map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="text-[#8a96aa] flex-shrink-0"><item.icon size={13} /></span>
                  <span className="text-xs text-[#8a96aa]">{item.label}：</span>
                  <span className="text-xs font-semibold text-[#18243a] truncate">{item.value}</span>
                </div>
              )))}
            </div>

            {/* 边缘：资质速览（精简为计数条） */}
            <div className="flex items-start gap-4">
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-[#5a6d8a] uppercase tracking-wider">资质概览</p>
                {[
                  { label: '总资质', value: qualStats.total, color: '#064ea2' },
                  { label: '有效', value: qualStats.valid, color: '#11a874' },
                  { label: '即将到期', value: qualStats.expiring, color: '#f5a623' },
                  { label: '已过期', value: qualStats.expired, color: '#e74c3c' },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[11px] text-[#8a96aa]">{s.label}</span>
                    <span className="text-sm font-extrabold tabular-nums" style={{ color: s.color }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
         Tab 导航
         ═══════════════════════════════════════════════════ */}
      <div className="flex border-b border-[var(--border)] mb-6 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-3 text-sm font-semibold transition border-b-2 -mb-px whitespace-nowrap ${
              activeTab === tab.key ? 'text-[#064ea2] border-[#064ea2]' : 'text-[#5a6d8a] border-transparent hover:text-[#18243a]'
            }`}>
            {tab.label}{tab.count !== undefined && <span className="ml-1.5 text-xs opacity-50">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════
         Tab 内容
         ═══════════════════════════════════════════════════ */}
      <div className="">
        {/* ── 基本信息（合并原审核摘要字段，不再分开重复）── */}
        {activeTab === 'info' && (
          <div className="space-y-6">
            {/* 企业信息分组 */}
            <div>
              <h3 className="text-[11px] font-extrabold text-[#5a6d8a] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Building2 size={13} />企业信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                {[
                  ['企业名称', supplier.name],
                  ['统一社会信用代码', supplier.creditCode || '—'],
                  ['企业类型', supplier.enterpriseType],
                  ['法定代表人', supplier.legalPerson],
                  ['注册地址', supplier.registeredAddress || '—'],
                  ['经营范围', supplier.businessScope || '—'],
                  ['供应商分类', supplier.classification?.name || '未分类'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-[11px] text-[#8a96aa] mb-0.5">{label}</p>
                    <p className="text-[13px] font-semibold text-[#18243a]">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <hr className="border-[#eef3f8]" />

            {/* 账户信息分组 */}
            <div>
              <h3 className="text-[11px] font-extrabold text-[#5a6d8a] uppercase tracking-wider mb-3 flex items-center gap-2">
                <User size={13} />账户信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                {[
                  ['用户名', supplier.user?.username || '—'],
                  ['显示名', supplier.user?.displayName || '—'],
                  ['注册邮箱', supplier.user?.email || '—'],
                  ['账户状态', supplier.user?.isActive ? '已激活' : '未激活'],
                  ['注册时间', new Date(supplier.createdAt).toLocaleDateString('zh-CN')],
                  ['最后更新', new Date(supplier.updatedAt).toLocaleDateString('zh-CN')],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-[11px] text-[#8a96aa] mb-0.5">{label}</p>
                    <p className="text-[13px] font-semibold text-[#18243a]">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 评价概览（如已有评价） */}
            {evaluations.length > 0 && (
              <>
                <hr className="border-[#eef3f8]" />
                <div>
                  <h3 className="text-[11px] font-extrabold text-[#5a6d8a] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Award size={13} />评价概览
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                    {[
                      { label: '评价次数', value: evaluations.length, color: '#064ea2' },
                      { label: '综合评价', value: avgScore || '—', color: '#11a874' },
                      { label: 'A 级', value: evalLevelCounts.A, color: '#11a874' },
                      { label: 'B 级', value: evalLevelCounts.B, color: '#064ea2' },
                      { label: 'C 级', value: evalLevelCounts.C, color: '#f5a623' },
                      { label: 'D 级', value: evalLevelCounts.D, color: '#e74c3c' },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl bg-[#f7f9fc] p-3 text-center">
                        <p className="text-[10px] text-[#8a96aa] mb-1">{s.label}</p>
                        <p className="text-xl font-extrabold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 主要联系人（如有） */}
            {primaryContact && (
              <>
                <hr className="border-[#eef3f8]" />
                <div>
                  <h3 className="text-[11px] font-extrabold text-[#5a6d8a] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Phone size={13} />主要联系人
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
                    <span><span className="text-[#8a96aa]">姓名：</span><strong className="text-[#18243a]">{primaryContact.name}</strong></span>
                    <span><span className="text-[#8a96aa]">电话：</span><strong className="text-[#18243a] font-mono">{primaryContact.phone}</strong></span>
                    {primaryContact.email && <span><span className="text-[#8a96aa]">邮箱：</span><strong className="text-[#18243a]">{primaryContact.email}</strong></span>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── 联系人 ── */}
        {activeTab === 'contacts' && (
          <div>
            {(!supplier.contacts || supplier.contacts.length === 0) ? (
              <p className="text-[#8a96aa] text-center py-10">暂无联系人信息</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[#5a6d8a]">
                    <th className="pb-3 px-4">姓名</th><th className="pb-3 px-4">手机号</th><th className="pb-3 px-4">邮箱</th><th className="pb-3 px-4">类型</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.contacts.map(c => (
                    <tr key={c.id} className="border-b border-white/15 hover:bg-[#f7f9fc]">
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
              </div>
            )}
          </div>
        )}

        {/* ── 资质材料 ── */}
        {activeTab === 'qualifications' && (
          <div>
            {qualifications.length === 0 ? (
              <p className="text-[#8a96aa] text-center py-10">暂无资质材料</p>
            ) : (
              <div className="space-y-4">
                {/* 资质统计条 */}
                <div className="flex items-center gap-5 pb-3 border-b border-[#eef3f8]">
                  {[
                    { label: '总资质', value: qualStats.total, color: '#064ea2' },
                    { label: '有效', value: qualStats.valid, color: '#11a874' },
                    { label: '即将到期', value: qualStats.expiring, color: '#f5a623' },
                    { label: '已过期', value: qualStats.expired, color: '#e74c3c' },
                  ].map(stat => (
                    <div key={stat.label} className="flex items-center gap-1.5">
                      <span className="text-xs text-[#8a96aa]">{stat.label}</span>
                      <span className="text-lg font-black tabular-nums" style={{ color: stat.color }}>{stat.value}</span>
                    </div>
                  ))}
                </div>
                {/* 资质卡片 grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {qualifications.map(q => {
                    const qs = getQualStatus(q);
                    const now = new Date();
                    const totalDays = q.validFrom && q.validTo
                      ? (new Date(q.validTo).getTime() - new Date(q.validFrom).getTime()) / (1000 * 60 * 60 * 24)
                      : 0;
                    const elapsedDays = q.validFrom
                      ? (now.getTime() - new Date(q.validFrom).getTime()) / (1000 * 60 * 60 * 24)
                      : 0;
                    const pct = totalDays > 0 ? Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100)) : 0;
                    const barColor = qs.label === '已过期' ? '#e74c3c' : qs.label === '即将到期' ? '#f5a623' : '#11a874';

                    return (
                      <div key={q.id} className="card-enter border border-white/15 rounded-xl p-5 hover:shadow-sm transition bg-white/40">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded" style={{ color: '#064ea2', backgroundColor: '#064ea212' }}>{q.type}</span>
                          </div>
                          <span className="text-xs px-2.5 py-1 rounded font-semibold" style={{ color: qs.color, backgroundColor: qs.bg }}>{qs.label}</span>
                        </div>
                        <p className="font-bold text-[#18243a] text-sm mb-3">{q.name}</p>
                        {q.validFrom && q.validTo ? (
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-[#8a96aa]">{new Date(q.validFrom).toLocaleDateString('zh-CN')}</span>
                              <span className="text-[#8a96aa]">{new Date(q.validTo).toLocaleDateString('zh-CN')}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[#f1f5f9] overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-[#11a874] font-semibold">长期有效</p>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {[
                    { label: '评价次数', value: evaluations.length, color: '#064ea2' },
                    { label: '综合评价', value: avgScore || '—', color: '#11a874' },
                    { label: 'A 级', value: evalLevelCounts.A, color: '#11a874' },
                    { label: 'B 级', value: evalLevelCounts.B, color: '#064ea2' },
                    { label: 'C 级', value: evalLevelCounts.C, color: '#f5a623' },
                    { label: 'D 级', value: evalLevelCounts.D, color: '#e74c3c' },
                  ].map(s => (
                    <div key={s.label} className="bg-[#f7f9fc] rounded-xl p-3 text-center">
                      <p className="text-[10px] text-[#8a96aa] mb-1">{s.label}</p>
                      <p className="text-xl font-extrabold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[750px] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[#5a6d8a]">
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
                        <tr key={e.id} className="border-b border-white/15 hover:bg-[#f7f9fc]">
                          <td className="py-3 px-4 font-bold text-[#18243a]">{Number(e.overallScore).toFixed(1)}</td>
                          <td className="py-3 px-4"><span className="px-2.5 py-1 text-xs font-semibold rounded" style={{ color: lc.color, backgroundColor: lc.bg }}>{lc.label} ({e.level})</span></td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{Number(e.completenessScore).toFixed(1)}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{Number(e.responsivenessScore).toFixed(1)}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{Number(e.cooperationScore).toFixed(1)}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{Number(e.complianceScore).toFixed(1)}</td>
                          <td className="py-3 px-4 text-[#5a6d8a]">{e.evaluator?.displayName || '—'}</td>
                          <td className="py-3 px-4 text-[#8a96aa]">{new Date(e.createdAt).toLocaleDateString('zh-CN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[#5a6d8a]">
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
                      <tr key={c.id} className="border-b border-white/15 hover:bg-[#f7f9fc]">
                        <td className="py-3 px-4 font-semibold text-[#18243a]">{c.fieldLabel}</td>
                        <td className="py-3 px-4 text-[#8a96aa] max-w-[150px] truncate">{c.oldValue || '—'}</td>
                        <td className="py-3 px-4 text-[#064ea2] font-medium max-w-[150px] truncate">{c.newValue || '—'}</td>
                        <td className="py-3 px-4 text-[#8a96aa] max-w-[150px] truncate">{c.reason || '—'}</td>
                        <td className="py-3 px-4"><span className="px-2.5 py-1 text-xs font-semibold rounded" style={{ color: cs.color, backgroundColor: cs.bg }}>{cs.label}</span></td>
                        <td className="py-3 px-4 text-[#8a96aa]">{new Date(c.createdAt).toLocaleDateString('zh-CN')}</td>
                        <td className="py-3 px-4 text-right">
                          {c.status === 'PENDING' && (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'approve' }); }} className="btn-press px-3 py-1.5 text-xs font-semibold text-white bg-[#11a874] rounded-lg hover:bg-[#0e8c5f] transition">通过</button>
                              <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'reject' }); }} className="btn-press px-3 py-1.5 text-xs font-semibold text-white bg-[#e74c3c] rounded-lg hover:bg-[#c0392b] transition">拒绝</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 审批操作栏（PENDING/RETURNED 时固定在底部）═══ */}
      {isPending && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/82 backdrop-blur-lg border-t border-white/30 shadow-[0_-4px_24px_rgba(0,0,0,0.04)] px-6 py-3">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-4">
            <div className="flex-1 flex items-center gap-3">
              <span className="text-sm font-bold text-[#18243a]">审批操作</span>
              {approvalMode === null ? (
                <span className="text-xs text-[#8a96aa]">选择审批意见，处理该供应商的注册申请</span>
              ) : (
                <span className="text-xs font-semibold" style={{ color: approvalMode === 'approve' ? '#11a874' : approvalMode === 'return' ? '#f5a623' : '#e74c3c' }}>
                  {approvalMode === 'approve' ? '审核通过 — 供应商入库，账户激活' : approvalMode === 'return' ? '退回补正 — 供应商可修改后重新提交' : '审核不通过 — 拒绝注册申请'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {approvalMode !== null && approvalMode !== 'approve' && (
                <input
                  value={approvalReason}
                  onChange={e => setApprovalReason(e.target.value)}
                  placeholder={approvalMode === 'return' ? '退回补正原因（供供应商修改）...' : '不通过原因...'}
                  className="w-64 px-3 py-2 border border-[var(--border)] rounded-lg text-sm h-10 focus:outline-none focus:border-[#064ea2]"
                />
              )}
              {approvalMode === null ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => setApprovalMode('approve')}
                    className="btn-press neu-btn-soft is-success">
                    <CheckCircle2 size={16} />通过
                  </button>
                  <button onClick={() => setApprovalMode('return')}
                    className="btn-press neu-btn-soft is-warning">
                    <RotateCcw size={16} />退回
                  </button>
                  <button onClick={() => setApprovalMode('reject')}
                    className="btn-press neu-btn-soft is-danger">
                    <XCircle size={16} />拒绝
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={closeApproval} className="neu-btn-soft">取消</button>
                  <button onClick={handleApproval} disabled={approvalLoading || (approvalMode !== 'approve' && !approvalReason.trim())}
                    className={`neu-btn-soft ${
                      approvalMode === 'approve' ? 'is-success' :
                      approvalMode === 'return' ? 'is-warning' : 'is-danger'
                    }`}>
                    {approvalLoading ? '处理中...' : `确认${approvalMode === 'approve' ? '通过' : approvalMode === 'return' ? '退回' : '拒绝'}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 变更审核弹窗 ═══ */}
      {reviewModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setReviewModal(null)}>
          <div className="modal-content glass-card w-full max-w-md rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border)]/60 px-6 py-4 flex items-center gap-3">
              <FileText size={18} className="text-[#064ea2]" />
              <div><h3 className="text-base font-bold text-[#18243a]">{reviewModal.type === 'approve' ? '确认通过变更' : '拒绝变更'}</h3></div>
            </div>
            <div className="p-6">
              {reviewModal.type === 'reject' && (
                <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)} placeholder="请填写拒绝原因..."
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm h-24 resize-none focus:outline-none focus:border-[#064ea2]" />
              )}
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setReviewModal(null)} className="neu-btn-soft">取消</button>
                <button onClick={handleReviewChange} disabled={reviewLoading || (reviewModal.type === 'reject' && !reviewReason.trim())}
                  className={`neu-btn-soft ${reviewModal.type === 'approve' ? 'is-success' : 'is-danger'}`}>
                  {reviewLoading ? '处理中...' : '确认'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 状态操作弹窗（停用/黑名单）═══ */}
      {actionModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setActionModal(null)}>
          <div className="modal-content glass-card w-full max-w-md rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border)]/60 px-6 py-4 flex items-center gap-3">
              <Building2 size={18} className={actionModal.type === 'blacklist' ? 'text-[#e74c3c]' : 'text-[#5a6d8a]'} />
              <div><h3 className="text-base font-bold text-[#18243a]">{actionModal.type === 'disable' ? '停用供应商' : '加入黑名单'}</h3></div>
            </div>
            <div className="p-6">
              <p className="text-sm text-[#5a6d8a] mb-3">供应商：<strong className="text-[#18243a]">{actionModal.supplier.name}</strong></p>
              <textarea value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="请填写原因..."
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm h-24 resize-none focus:outline-none focus:border-[#064ea2]" />
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setActionModal(null)} className="neu-btn-soft">取消</button>
                <button onClick={handleStatusAction} disabled={actionLoading || !actionReason.trim()}
                  className={`neu-btn-soft ${actionModal.type === 'blacklist' ? 'is-danger' : ''}`}>
                  {actionLoading ? '处理中...' : '确认'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 分类分配弹窗 ═══ */}
      {classModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setClassModal(false)}>
          <div className="modal-content glass-card w-full max-w-md rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border)]/60 px-6 py-4 flex items-center gap-3">
              <Award size={18} className="text-[#064ea2]" />
              <div><h3 className="text-base font-bold text-[#18243a]">分配供应商分类</h3></div>
            </div>
            <div className="p-6">
              <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2] mb-4">
                <option value="">不分类</option>
                {classifications.map(c => <option key={c.id} value={c.id}>{c.name}（{c.code}）</option>)}
              </select>
              <div className="flex justify-end gap-3">
                <button onClick={() => setClassModal(false)} className="neu-btn-soft">取消</button>
                <button onClick={handleAssignClass} disabled={classLoading}
                  className="neu-btn-primary">
                  {classLoading ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
