'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplier, getSupplierChanges, getSupplierEvaluations, getQualifications, approveChange, rejectChange, approveSupplier, rejectSupplier, returnSupplier, updateSupplierStatus, getSupplierCommunications, getSupplierDocuments, uploadSupplierDocument, deleteSupplierDocument, updateSupplierTags, uploadSupplierFile } from '@/lib/api/supplier';
import type { Supplier, SupplierChangeRecord, SupplierEvaluation, SupplierQualification } from '@/lib/types';
import type { CommunicationRecord, SupplierDocumentRecord } from '@/lib/api/supplier';
import { AlertBanner, type AlertSeverity, Breadcrumb, StatusBadge, Modal } from '@/components/workbench';
import { useSupplierAlerts } from '@/lib/hooks/use-alerts';
import { LEVEL_LABEL, LEVEL_COLOR } from '@water-erp/shared';
import { CheckCircle2, XCircle, RotateCcw, FileCheck, Building2, ShieldCheck, Calendar, Award, FileText, User, MapPin, Phone, Mail, Hash, MessageSquare, FolderOpen, Plus, Loader2, Trash2 } from 'lucide-react';
import { SupplierTimeline } from '@/components/supplier/timeline';
import { PortraitTab } from '@/components/supplier/portrait-tab';

import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';

type TabKey = 'info' | 'portrait' | 'contacts' | 'qualifications' | 'evaluations' | 'changes' | 'communications' | 'documents';

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核', RETURNED: '退回补正', APPROVED: '已入库', REJECTED: '审核不通过', DISABLED: '已停用', BLACKLIST: '黑名单',
};
const STATUS_TONE: Record<string, 'green' | 'blue' | 'orange' | 'red' | 'gray'> = {
  APPROVED: 'green', PENDING: 'blue', RETURNED: 'orange', REJECTED: 'red', DISABLED: 'gray', BLACKLIST: 'red',
};
const CHANGE_TONE: Record<string, 'blue' | 'green' | 'red'> = { PENDING: 'blue', APPROVED: 'green', REJECTED: 'red' };
const GRADE_TONE: Record<string, string> = { A: 'green', B: 'blue', C: 'orange', D: 'yellow', E: 'red' };

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

  // 业务标签编辑弹窗
  const [tagsModal, setTagsModal] = useState(false);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagsSaving, setTagsSaving] = useState(false);

  const [barCollapsed, setBarCollapsed] = useState(false);
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

  const [communications, setCommunications] = useState<CommunicationRecord[]>([]);
  const [commLoading, setCommLoading] = useState(false);
  const [documents, setDocuments] = useState<SupplierDocumentRecord[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [newDocNote, setNewDocNote] = useState('');
  const [newDocFile, setNewDocFile] = useState<File | null>(null);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (activeTab === 'communications' && communications.length === 0) { setCommLoading(true); getSupplierCommunications(id as string).then(setCommunications).catch(() => {}).finally(() => setCommLoading(false)); }
    if (activeTab === 'documents' && documents.length === 0) { setDocLoading(true); getSupplierDocuments(id as string).then(setDocuments).catch(() => {}).finally(() => setDocLoading(false)); }
  }, [activeTab, id]);

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
    } catch (e: any) { toast.error(e?.message || '操作失败'); }
    setActionLoading(false);
  };

  // ── 业务标签编辑 ──
  const handleSaveTags = async () => {
    if (!supplier) return;
    const filled = editTags.filter(t => t.trim());
    if (filled.length < 2) { toast.warning('请至少保留 2 个业务标签'); return; }
    setTagsSaving(true);
    try {
      await updateSupplierTags(supplier.id, filled);
      toast.success('业务标签已更新'); setTagsModal(false); loadAll();
    } catch (e: any) { toast.error(e?.response?.data?.error || e?.message || '更新失败'); }
    setTagsSaving(false);
  };

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      <div className="neu-card-static !rounded-2xl h-24" />
      <div className="flex gap-2 pb-1">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-8 w-20 rounded-lg" />)}</div>
      <div className="neu-card-static !rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-3 gap-6">{Array.from({ length: 9 }).map((_, i) => <div key={i}><div className="skeleton h-3 w-16 mb-1" /><div className="skeleton h-5 w-32" /></div>)}</div>
      </div>
    </div>
  );
  if (!supplier) return <div className="py-20 text-center text-sm text-[var(--danger)]">供应商不存在</div>;

  const backFrom = (typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('from') : null);
  const backPath = backFrom === 'selection' ? '/supplier/selection' : '/supplier/repository';
  const backLabel = backFrom === 'selection' ? '返回供应商选取' : '返回列表';
  const breadcrumbRoot = backFrom === 'selection' ? '供应商选取' : '供应商库';

  const stLabel = STATUS_LABEL[supplier.status] || supplier.status;
  const stTone = STATUS_TONE[supplier.status] || 'gray';
  const isPending = supplier.status === 'PENDING' || supplier.status === 'RETURNED';
  const isRejected = supplier.status === 'REJECTED';
  const daysSinceReg = Math.floor((Date.now() - new Date(supplier.createdAt).getTime()) / (1000 * 60 * 60 * 24));

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'info', label: '基本信息' },
    { key: 'portrait', label: '供应商画像' },
    { key: 'contacts', label: '联系人', count: supplier.contacts?.length },
    { key: 'qualifications', label: '资质材料', count: qualifications.length },
    { key: 'evaluations', label: '履约评价', count: evaluations.length },
    { key: 'changes', label: '变更记录', count: changes.length },
    { key: 'communications', label: '沟通记录' },
    { key: 'documents', label: '文件档案' },
  ];

  const getQualStatus = (q: SupplierQualification) => {
    if (!q.validTo) return { label: '长期有效', color: 'var(--success)' };
    const diffDays = (new Date(q.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return { label: '已过期', color: 'var(--danger)' };
    if (diffDays < 90) return { label: '即将到期', color: 'var(--warning)' };
    return { label: '有效', color: 'var(--success)' };
  };

  const evalLevelCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  evaluations.forEach(e => {
    const fg = e.finalGrade || (e as any).level;
    if (fg && evalLevelCounts.hasOwnProperty(fg)) evalLevelCounts[fg]++;
  });
  // 最常见等级
  let mostCommonGrade = '';
  let maxCount = 0;
  for (const [g, c] of Object.entries(evalLevelCounts)) { if (c > maxCount) { maxCount = c; mostCommonGrade = g; } }

  const qualStats = {
    total: qualifications.length,
    valid: qualifications.filter(q => getQualStatus(q).label === '有效').length,
    expiring: qualifications.filter(q => getQualStatus(q).label === '即将到期').length,
    expired: qualifications.filter(q => getQualStatus(q).label === '已过期').length,
  };

  const primaryContact = supplier.contacts?.find(c => c.isPrimary);
  const pendingHint = supplier.status === 'RETURNED' ? '补正中' : '待审核';

  return (
    <div className={isPending ? 'pb-24' : ''}>
      <Breadcrumb items={[{ label: breadcrumbRoot, path: backPath }, { label: supplier?.name || '详情' }]} />

      {/* ═══════════════════════════════════════════════════
         顶部信息卡 — 仅核心识别信息（详细字段移至基本信息Tab）
         ═══════════════════════════════════════════════════ */}
      <div className="neu-card-static !rounded-2xl p-5 mb-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="neu-icon-well flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-xl font-black text-[var(--accent)]">{supplier.name[0]}</div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold tracking-[-0.02em] text-[var(--foreground)]">{supplier.name}</h1>
              <StatusBadge tone={stTone}>{stLabel}</StatusBadge>
              {supplier.user?.isActive !== undefined && (
                <StatusBadge tone={supplier.user.isActive ? 'green' : 'red'}>{supplier.user.isActive ? '账户已激活' : '账户未激活'}</StatusBadge>
              )}
            </div>
            <p className="mt-1.5 text-sm text-[var(--muted-foreground)] flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><Hash size={11} />{supplier.creditCode || '信用代码未登记'}</span>
              {mostCommonGrade && <><span className="opacity-40">·</span><span className="inline-flex items-center gap-1">评价等级 <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[mostCommonGrade] }}>{mostCommonGrade}</span></span></>}
              <span className="opacity-40">·</span><span>注册 {daysSinceReg} 天</span>
            </p>

            {supplier.returnReason && supplier.status === 'RETURNED' && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                <RotateCcw size={13} className="mt-0.5 flex-shrink-0 text-[var(--warning)]" />
                <span className="text-[var(--muted-foreground)]"><strong className="text-[var(--warning)]">退回原因：</strong>{supplier.returnReason}</span>
              </div>
            )}
            {supplier.rejectReason && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                <XCircle size={13} className="mt-0.5 flex-shrink-0 text-[var(--danger)]" />
                <span className="text-[var(--muted-foreground)]"><strong className="text-[var(--danger)]">不通过原因：</strong>{supplier.rejectReason}</span>
              </div>
            )}
            {(supplier as any).disableReason && (supplier.status === 'DISABLED' || supplier.status === 'BLACKLIST') && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                <XCircle size={13} className="mt-0.5 flex-shrink-0 text-[var(--danger)]" />
                <span className="text-[var(--muted-foreground)]"><strong className="text-[var(--danger)]">{supplier.status === 'BLACKLIST' ? '不良名单原因：' : '停用原因：'}</strong>{(supplier as any).disableReason}</span>
              </div>
            )}
          </div>

          {/* 右侧操作 */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {supplier.status === 'APPROVED' && (
              <>
                <button onClick={() => {
                  const currentTags = (supplier as any).tags || [];
                  setEditTags(currentTags.length >= 2 ? [...currentTags] : ['', '']);
                  setTagsModal(true);
                }} className="neu-btn-xs">业务标签修改</button>
                <button onClick={() => { setActionReason(''); setActionModal({ type: 'disable', supplier }); }} className="neu-btn-xs is-warning">停用</button>
                <button onClick={() => { setActionReason(''); setActionModal({ type: 'blacklist', supplier }); }} className="neu-btn-xs is-danger">黑名单</button>
              </>
            )}
            <button onClick={() => router.push(backPath)} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              {backLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4"><AlertBanner items={alertItems} /></div>

      {/* ═══════════════════════════════════════════════════
         审批进度卡片 — 合并原「审核摘要」+「状态时间线」+ 资质速览
         仅 PENDING / RETURNED 显示
         ═══════════════════════════════════════════════════ */}
      {isPending && (
        <div className="neu-card-static !rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <FileCheck size={15} className="text-[var(--warning)]" />
            <span className="text-sm font-extrabold text-[var(--foreground)]">审批进度</span>
            <StatusBadge tone="orange" className="ml-auto">{pendingHint}</StatusBadge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* 左：时间线 */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center pt-1.5">
                  <div className="w-3 h-3 rounded-full bg-[var(--success)] ring-2 ring-[color-mix(in_oklch,var(--success)_20%,transparent)]" />
                  <div className="w-0.5 h-9 bg-[var(--border)]" />
                  <div className="w-3 h-3 rounded-full ring-2" style={{ backgroundColor: 'var(--warning)', boxShadow: '0 0 0 2px color-mix(in oklch, var(--warning) 20%, transparent)' }} />
                </div>
                <div className="space-y-3 flex-1 pb-1">
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">供应商注册申请</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{new Date(supplier.createdAt).toLocaleDateString('zh-CN')} · 提交 {qualifications.length} 份资质材料</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--warning)]">{supplier.status === 'RETURNED' ? '退回补正' : '等待审核'}</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
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
                { icon: Building2, label: '企业类型', value: normalizeEnterpriseType(supplier.enterpriseType) },
                { icon: ShieldCheck, label: '法定代表人', value: supplier.legalPerson },
                { icon: MapPin, label: '注册地址', value: supplier.registeredAddress || '未登记' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <item.icon size={13} className="text-[var(--muted-foreground)] flex-shrink-0" />
                  <span className="text-xs text-[var(--muted-foreground)]">{item.label}：</span>
                  <span className="text-xs font-semibold text-[var(--foreground)] truncate">{item.value}</span>
                </div>
              ))}
            </div>

            {/* 右：联系人与账户 */}
            <div className="space-y-2.5">
              {((
                [primaryContact && { icon: User, label: '主要联系人', value: `${primaryContact.name}${primaryContact.position ? ' · ' + primaryContact.position : ''}${primaryContact.phone ? ' · ' + primaryContact.phone : ''}` },
                { icon: Mail, label: '注册邮箱', value: supplier.user?.email || '未登记' },
                { icon: Calendar, label: '用户名', value: supplier.user?.username || '—' },
              ] as { icon: React.ComponentType<{ size?: number }>; label: string; value: string }[]).filter(Boolean).map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="text-[var(--muted-foreground)] flex-shrink-0"><item.icon size={13} /></span>
                  <span className="text-xs text-[var(--muted-foreground)]">{item.label}：</span>
                  <span className="text-xs font-semibold text-[var(--foreground)] truncate">{item.value}</span>
                </div>
              )))}
            </div>

            {/* 边缘：资质速览（精简为计数条） */}
            <div className="flex items-start gap-4">
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">资质概览</p>
                {[
                  { label: '总资质', value: qualStats.total, color: 'var(--accent)' },
                  { label: '有效', value: qualStats.valid, color: 'var(--success)' },
                  { label: '即将到期', value: qualStats.expiring, color: 'var(--warning)' },
                  { label: '已过期', value: qualStats.expired, color: 'var(--danger)' },
                ].map(s => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[11px] text-[var(--muted-foreground)]">{s.label}</span>
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
      <div className="neu-tab-bar mb-5 flex-wrap">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`neu-tab whitespace-nowrap ${activeTab === tab.key ? 'is-active' : ''}`}>
            {tab.label}{tab.count !== undefined && <span className="neu-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════
         Tab 内容
         ═══════════════════════════════════════════════════ */}
      <div>
        {/* ── 基本信息 ── */}
        {activeTab === 'info' && (
          <div className="space-y-6">
            <div className="neu-card-static !rounded-2xl p-5 space-y-6">
              {/* 企业信息分组 */}
              <div>
                <h3 className="text-[11px] font-extrabold text-[var(--muted-foreground)] uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Building2 size={13} />企业信息
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                  {[
                    ['企业名称', supplier.name],
                    ['统一社会信用代码', supplier.creditCode || '—'],
                    ['企业类型', normalizeEnterpriseType(supplier.enterpriseType)],
                    ['法定代表人', supplier.legalPerson],
                    ['注册地址', supplier.registeredAddress || '—'],
                    ['经营范围', supplier.businessScope || '—'],
                    ['注册时间', new Date(supplier.createdAt).toLocaleDateString('zh-CN')],
                    ['最后更新', new Date(supplier.updatedAt).toLocaleDateString('zh-CN')],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <p className="text-[11px] text-[var(--muted-foreground)] mb-0.5">{label}</p>
                      <p className="text-[13px] font-semibold text-[var(--foreground)]">{value}</p>
                    </div>
                  ))}
                </div>

                {/* 业务标签（与 :3004 企业信息页对齐——始终展示，空态引导） */}
                <div className="mt-5 pt-4 border-t border-[var(--border)]">
                  <p className="text-[11px] text-[var(--muted-foreground)] mb-2">业务标签</p>
                  {(supplier as any).tags?.length > 0 ? (
                    <div className="flex flex-wrap gap-2.5">
                      {(supplier as any).tags.map((tag: string, i: number) => (
                        <span key={i} className="biz-tag">{tag}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-[var(--muted-foreground)]">暂无业务标签，供应商可通过变更申请补充</p>
                  )}
                </div>
              </div>

              {/* 评价概览（如已有评价） */}
              {evaluations.length > 0 && (
                <div className="border-t border-[var(--border)] pt-6">
                  <h3 className="text-[11px] font-extrabold text-[var(--muted-foreground)] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Award size={13} />评价概览
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                    {[
                      { label: '评价次数', value: evaluations.length, color: 'var(--accent)' },
                      { label: '主要等级', value: mostCommonGrade || '—', color: mostCommonGrade ? LEVEL_COLOR[mostCommonGrade] : 'var(--muted-foreground)' },
                      { label: 'A 级', value: evalLevelCounts.A, color: 'var(--success)' },
                      { label: 'B 级', value: evalLevelCounts.B, color: 'var(--accent)' },
                      { label: 'C 级', value: evalLevelCounts.C, color: 'var(--warning)' },
                      { label: 'D 级', value: evalLevelCounts.D, color: '#ca8a04' },
                      { label: 'E 级', value: evalLevelCounts.E, color: 'var(--danger)' },
                    ].map(s => (
                      <div key={s.label} className="neu-card-static !rounded-xl p-3 text-center">
                        <p className="text-[10px] text-[var(--muted-foreground)] mb-1">{s.label}</p>
                        <p className="text-xl font-extrabold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 主要联系人（如有） */}
              {primaryContact && (
                <div className="border-t border-[var(--border)] pt-6">
                  <h3 className="text-[11px] font-extrabold text-[var(--muted-foreground)] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Phone size={13} />主要联系人
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
                    <span><span className="text-[var(--muted-foreground)]">姓名：</span><strong className="text-[var(--foreground)]">{primaryContact.name}</strong></span>
                    {primaryContact.position && <span><span className="text-[var(--muted-foreground)]">职位：</span><strong className="text-[var(--foreground)]">{primaryContact.position}</strong></span>}
                    <span><span className="text-[var(--muted-foreground)]">电话：</span><strong className="text-[var(--foreground)] font-mono">{primaryContact.phone}</strong></span>
                    {primaryContact.email && <span><span className="text-[var(--muted-foreground)]">邮箱：</span><strong className="text-[var(--foreground)]">{primaryContact.email}</strong></span>}
                  </div>
                </div>
              )}
            </div>

            {/* 生命周期时间线 */}
            <section className="neu-card-static !rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)] mb-4">生命周期</h3>
              <SupplierTimeline supplierId={id as string} />
            </section>
          </div>
        )}

        {/* ── 供应商画像 ── */}
        {activeTab === 'portrait' && (
          <section><PortraitTab supplierId={id as string} /></section>
        )}

        {/* ── 联系人 ── */}
        {activeTab === 'contacts' && (
          <div className="neu-table-card overflow-hidden">
            {(!supplier.contacts || supplier.contacts.length === 0) ? (
              <p className="text-[var(--muted-foreground)] text-center py-10 text-sm">暂无联系人信息</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="workbench-table">
                  <thead>
                    <tr><th>姓名</th><th>手机号</th><th>邮箱</th><th>职位</th><th>类型</th></tr>
                  </thead>
                  <tbody>
                    {supplier.contacts.map(c => (
                      <tr key={c.id}>
                        <td className="font-semibold text-[var(--foreground)]">{c.name}</td>
                        <td className="text-[var(--muted-foreground)] font-mono text-xs">{c.phone}</td>
                        <td className="text-[var(--muted-foreground)]">{c.email || '—'}</td>
                        <td className="text-[var(--muted-foreground)]">{c.position || '—'}</td>
                        <td>
                          {c.isPrimary
                            ? <StatusBadge tone="blue">主要联系人</StatusBadge>
                            : <span className="text-[var(--muted-foreground)] text-xs">普通联系人</span>}
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
              <div className="neu-card-static !rounded-2xl py-10 text-center">
                <FolderOpen size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
                <p className="text-sm text-[var(--muted-foreground)]">暂无资质材料</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 资质统计条 */}
                <div className="neu-card-static !rounded-2xl p-4 flex items-center gap-5 flex-wrap">
                  {[
                    { label: '总资质', value: qualStats.total, color: 'var(--accent)' },
                    { label: '有效', value: qualStats.valid, color: 'var(--success)' },
                    { label: '即将到期', value: qualStats.expiring, color: 'var(--warning)' },
                    { label: '已过期', value: qualStats.expired, color: 'var(--danger)' },
                  ].map(stat => (
                    <div key={stat.label} className="flex items-center gap-1.5">
                      <span className="text-xs text-[var(--muted-foreground)]">{stat.label}</span>
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
                    const barColor = qs.label === '已过期' ? 'var(--danger)' : qs.label === '即将到期' ? 'var(--warning)' : 'var(--success)';

                    return (
                      <div key={q.id} className="neu-card-static !rounded-xl p-5">
                        <div className="flex justify-between items-start mb-3">
                          <StatusBadge tone="blue">{q.type}</StatusBadge>
                          <span className="text-xs px-2.5 py-1 rounded font-semibold" style={{ color: qs.color, backgroundColor: `color-mix(in oklch, ${qs.color} 12%, transparent)` }}>{qs.label}</span>
                        </div>
                        <p className="font-bold text-[var(--foreground)] text-sm mb-3">{q.name}</p>
                        {q.validFrom && q.validTo ? (
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-[var(--muted-foreground)]">{new Date(q.validFrom).toLocaleDateString('zh-CN')}</span>
                              <span className="text-[var(--muted-foreground)]">{new Date(q.validTo).toLocaleDateString('zh-CN')}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-[var(--muted)]/30 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--success)] font-semibold">长期有效</p>
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
              <div className="neu-card-static !rounded-2xl py-10 text-center">
                <Award size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
                <p className="text-sm text-[var(--muted-foreground)]">暂无履约评价记录</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-5">
                  {[
                    { label: '评价次数', value: evaluations.length, color: 'var(--accent)' },
                    { label: '主要等级', value: mostCommonGrade || '—', color: mostCommonGrade ? LEVEL_COLOR[mostCommonGrade] : 'var(--muted-foreground)' },
                    { label: 'A 级', value: evalLevelCounts.A, color: 'var(--success)' },
                    { label: 'B 级', value: evalLevelCounts.B, color: 'var(--accent)' },
                    { label: 'C 级', value: evalLevelCounts.C, color: 'var(--warning)' },
                    { label: 'D 级', value: evalLevelCounts.D, color: '#ca8a04' },
                    { label: 'E 级', value: evalLevelCounts.E, color: 'var(--danger)' },
                  ].map(s => (
                    <div key={s.label} className="neu-card-static !rounded-xl p-3 text-center">
                      <p className="text-[10px] text-[var(--muted-foreground)] mb-1">{s.label}</p>
                      <p className="text-xl font-extrabold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="neu-table-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="workbench-table w-full min-w-[850px]">
                      <thead>
                        <tr>
                          <th>综合等级</th>
                          <th>资料完整性</th><th>响应及时性</th>
                          <th>配合协作</th><th>合规守信</th>
                          <th>综合评价</th>
                          <th>评价人</th><th>时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluations.map(e => {
                          const fg = e.finalGrade || (e as any).level;
                          const gradeColor = LEVEL_COLOR[fg] || 'var(--muted-foreground)';
                          return (
                            <tr key={e.id}>
                              <td>
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-extrabold text-white" style={{ backgroundColor: gradeColor }}>{fg}</span>
                                  <span className="text-xs font-semibold" style={{ color: gradeColor }}>{LEVEL_LABEL[fg]}</span>
                                </span>
                              </td>
                              <td>{e.completenessGrade ? <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.completenessGrade] }}>{e.completenessGrade}</span> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                              <td>{e.responsivenessGrade ? <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.responsivenessGrade] }}>{e.responsivenessGrade}</span> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                              <td>{e.cooperationGrade ? <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.cooperationGrade] }}>{e.cooperationGrade}</span> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                              <td>{e.complianceGrade ? <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.complianceGrade] }}>{e.complianceGrade}</span> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                              <td>{e.comprehensiveGrade ? <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[e.comprehensiveGrade] }}>{e.comprehensiveGrade}</span> : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
                              <td className="text-[var(--muted-foreground)]">{e.evaluator?.displayName || '—'}</td>
                              <td className="text-[var(--muted-foreground)]">{new Date(e.createdAt).toLocaleDateString('zh-CN')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── 变更记录 ── */}
        {activeTab === 'changes' && (
          <div>
            {changes.length === 0 ? (
              <div className="neu-card-static !rounded-2xl py-10 text-center">
                <FileText size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
                <p className="text-sm text-[var(--muted-foreground)]">暂无变更记录</p>
              </div>
            ) : (
              <div className="neu-table-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="workbench-table w-full min-w-[680px]">
                    <thead>
                      <tr>
                        <th>变更字段</th><th>原值</th>
                        <th>新值</th><th>原因</th>
                        <th>状态</th><th>变更时间</th>
                        <th className="text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map(c => (
                        <tr key={c.id}>
                          <td className="font-semibold text-[var(--foreground)]">
                            {c.fieldLabel}
                            {c.fieldName === 'convertToRegular' && (
                              <span className="ml-1 inline-flex items-center rounded-full bg-[color-mix(in_oklch,var(--accent)_15%,transparent)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent)]">转正</span>
                            )}
                          </td>
                          <td className="text-[var(--muted-foreground)] max-w-[150px] truncate">{c.oldValue || '—'}</td>
                          <td className="text-[var(--accent)] font-medium max-w-[150px] truncate">{c.fieldName === 'convertToRegular' ? '企业资料+联系人+资质' : (c.newValue || '—')}</td>
                          <td className="text-[var(--muted-foreground)] max-w-[150px] truncate">{c.reason || '—'}</td>
                          <td><StatusBadge tone={CHANGE_TONE[c.status] || 'gray'}>{c.status === 'PENDING' ? '待审批' : c.status === 'APPROVED' ? '已通过' : '已拒绝'}</StatusBadge></td>
                          <td className="text-[var(--muted-foreground)]">{new Date(c.createdAt).toLocaleDateString('zh-CN')}</td>
                          <td className="text-right">
                            {c.status === 'PENDING' && (
                              <div className="flex justify-end gap-1.5">
                                <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'approve' }); }} className="neu-btn-xs is-success">通过</button>
                                <button onClick={() => { setReviewReason(''); setReviewModal({ changeId: c.id, type: 'reject' }); }} className="neu-btn-xs is-danger">拒绝</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ 沟通记录 ══ */}
      {activeTab === 'communications' && (
        <section>
          {commLoading ? (
            <div className="py-8 text-center"><Loader2 size={14} className="animate-spin mx-auto mb-2" /><span className="text-sm text-[var(--muted-foreground)]">加载中...</span></div>
          ) : communications.length === 0 ? (
            <div className="neu-card-static !rounded-2xl py-10 text-center">
              <MessageSquare size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
              <p className="text-sm text-[var(--muted-foreground)]">暂无沟通记录</p>
            </div>
          ) : (
            <div className="space-y-2">
              {communications.map(c => (
                <div key={c.id} className={`neu-card-static !rounded-xl p-4 ${!c.isRead ? 'ring-1 ring-[var(--accent)]/20' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="blue">{c.type}</StatusBadge>
                        {!c.isRead && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                      </div>
                      <h4 className="text-sm font-semibold text-[var(--foreground)] mt-1.5">{c.title}</h4>
                      <p className="text-xs text-[var(--muted-foreground)] mt-1 line-clamp-2">{c.content}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] text-[var(--muted-foreground)]/70">{new Date(c.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                      {c.channels.length > 0 && <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{c.channels.join(' · ')}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ══ 文件档案 ══ */}
      {activeTab === 'documents' && (
        <section>
          {docLoading ? (
            <div className="py-8 text-center"><Loader2 size={14} className="animate-spin mx-auto mb-2" /><span className="text-sm text-[var(--muted-foreground)]">加载中...</span></div>
          ) : (
            <>
              {/* Upload form */}
              <div className="neu-card-static !rounded-2xl p-4 mb-4 flex flex-wrap gap-2 items-center">
                {/* 真实文件选择：先上传 MinIO 拿到 url，杜绝 fileUrl:'#' 假记录（B10） */}
                <label className="neu-btn-xs gap-1 cursor-pointer">
                  <Plus size={12} />{newDocFile ? newDocFile.name : '选择文件'}
                  <input type="file" className="hidden" onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setNewDocFile(f);
                    if (f && !newDocName.trim()) setNewDocName(f.name);
                  }} />
                </label>
                <input value={newDocName} onChange={e => setNewDocName(e.target.value)} placeholder="文件名称" className="neu-input !h-9 !text-xs !flex-1 min-w-[140px]" />
                <input value={newDocNote} onChange={e => setNewDocNote(e.target.value)} placeholder="备注（可选）" className="neu-input !h-9 !text-xs !w-auto" />
                <button
                  onClick={async () => {
                    if (!newDocFile) { toast.error('请先选择文件'); return; }
                    if (!newDocName.trim()) { toast.error('请填写文件名称'); return; }
                    setDocUploading(true);
                    try {
                      const uploaded = await uploadSupplierFile(newDocFile);
                      const doc = await uploadSupplierDocument(id as string, {
                        type: 'other',
                        name: newDocName.trim(),
                        fileUrl: uploaded.url,
                        fileSize: uploaded.size,
                        note: newDocNote || undefined,
                      });
                      setDocuments(prev => [doc, ...prev]); setNewDocName(''); setNewDocNote(''); setNewDocFile(null);
                      toast.success('文件已上传并添加');
                    } catch (e: any) { toast.error(e?.message || '上传失败'); }
                    setDocUploading(false);
                  }}
                  disabled={docUploading || !newDocFile || !newDocName.trim()} className="neu-btn-xs gap-1"
                >
                  {docUploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}添加文件
                </button>
              </div>

              {documents.length === 0 ? (
                <div className="neu-card-static !rounded-2xl py-10 text-center">
                  <FolderOpen size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
                  <p className="text-sm text-[var(--muted-foreground)]">暂无文件档案</p>
                </div>
              ) : (
                <div className="neu-table-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="workbench-table w-full">
                      <thead>
                        <tr><th>文件名称</th><th>类型</th><th>上传人</th><th>上传时间</th><th className="w-20">操作</th></tr>
                      </thead>
                      <tbody>
                        {documents.map(d => (
                          <tr key={d.id}>
                            <td className="text-sm font-semibold text-[var(--foreground)]">{d.name}</td>
                            <td className="text-sm text-[var(--muted-foreground)]">{d.type}</td>
                            <td className="text-sm text-[var(--muted-foreground)]">{d.uploader?.displayName || '—'}</td>
                            <td className="text-sm tabular-nums text-[var(--muted-foreground)]">{new Date(d.createdAt).toLocaleDateString('zh-CN')}</td>
                            <td>
                              <button onClick={async () => { try { await deleteSupplierDocument(id as string, d.id); setDocuments(prev => prev.filter(x => x.id !== d.id)); toast.success('已删除'); } catch { toast.error('删除失败'); } }}
                                className="neu-btn-xs is-danger"><Trash2 size={12} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ═══ 审批操作栏（PENDING/RETURNED 时固定在底部）═══ */}
      {isPending && (
        <div className={`fixed bottom-0 left-0 right-0 z-40 bg-[var(--background)]/85 backdrop-blur-lg border-t border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] transition-all duration-200 ${barCollapsed ? 'px-6 py-1.5' : 'px-6 py-3'}`}>
          {barCollapsed ? (
            <div className="max-w-6xl mx-auto flex items-center gap-3">
              <span className="text-[11px] font-bold text-[var(--muted-foreground)]">审批操作 · {pendingHint}</span>
              <button onClick={() => setBarCollapsed(false)} className="neu-btn-xs ml-auto">展开</button>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-4">
              <div className="flex-1 flex items-center gap-3 min-w-[200px]">
                <span className="text-sm font-bold text-[var(--foreground)]">审批操作</span>
                {approvalMode === null ? (
                  <span className="text-xs text-[var(--muted-foreground)]">选择审批意见，处理该供应商的注册申请</span>
                ) : (
                  <span className="text-xs font-semibold" style={{ color: approvalMode === 'approve' ? 'var(--success)' : approvalMode === 'return' ? 'var(--warning)' : 'var(--danger)' }}>
                    {approvalMode === 'approve' ? '审核通过 — 供应商入库，账户激活' : approvalMode === 'return' ? '退回补正 — 供应商可修改后重新提交' : '审核不通过 — 拒绝注册申请'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {approvalMode !== null && approvalMode !== 'approve' && (
                  <input
                    value={approvalReason}
                    onChange={e => setApprovalReason(e.target.value)}
                    placeholder={approvalMode === 'return' ? '退回补正原因（供供应商修改）...' : '不通过原因...'}
                    className="neu-input w-64"
                  />
                )}
                {approvalMode === null ? (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setApprovalMode('approve')} className="neu-btn-soft is-success"><CheckCircle2 size={16} />通过</button>
                    <button onClick={() => setApprovalMode('return')} className="neu-btn-soft is-warning"><RotateCcw size={16} />退回</button>
                    <button onClick={() => setApprovalMode('reject')} className="neu-btn-soft is-danger"><XCircle size={16} />拒绝</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={closeApproval} className="neu-btn-soft">取消</button>
                    <button onClick={handleApproval} disabled={approvalLoading || (approvalMode !== 'approve' && !approvalReason.trim())}
                      className={`neu-btn-soft ${approvalMode === 'approve' ? 'is-success' : approvalMode === 'return' ? 'is-warning' : 'is-danger'}`}>
                      {approvalLoading ? '处理中...' : `确认${approvalMode === 'approve' ? '通过' : approvalMode === 'return' ? '退回' : '拒绝'}`}
                    </button>
                  </div>
                )}
                <button onClick={() => setBarCollapsed(true)} className="neu-btn-xs ml-2">收起</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ 变更审核弹窗 ═══ */}
      {reviewModal && (
        <Modal
          open
          onClose={() => setReviewModal(null)}
          title={reviewModal.type === 'approve' ? '确认通过变更' : '拒绝变更'}
          footer={
            <>
              <button onClick={() => setReviewModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={handleReviewChange} disabled={reviewLoading || (reviewModal.type === 'reject' && !reviewReason.trim())}
                className={`neu-btn-soft ${reviewModal.type === 'approve' ? 'is-success' : 'is-danger'}`}>
                {reviewLoading ? '处理中...' : '确认'}
              </button>
            </>
          }
        >
          {reviewModal.type === 'reject' && (
            <textarea value={reviewReason} onChange={e => setReviewReason(e.target.value)} placeholder="请填写拒绝原因..." className="neu-input w-full h-24 resize-none text-sm" />
          )}
        </Modal>
      )}

      {/* ═══ 状态操作弹窗（停用/黑名单）═══ */}
      {actionModal && (
        <Modal
          open
          onClose={() => setActionModal(null)}
          title={actionModal.type === 'disable' ? '停用供应商' : '加入黑名单'}
          description={<>供应商：<strong className="text-[var(--foreground)]">{actionModal.supplier.name}</strong></>}
          footer={
            <>
              <button onClick={() => setActionModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={handleStatusAction} disabled={actionLoading || !actionReason.trim()}
                className={`neu-btn-soft ${actionModal.type === 'blacklist' ? 'is-danger' : 'is-warning'}`}>
                {actionLoading ? '处理中...' : '确认'}
              </button>
            </>
          }
        >
          <textarea value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="请填写原因..." className="neu-input w-full h-24 resize-none text-sm" />
        </Modal>
      )}

      {/* ═══ 业务标签编辑弹窗 ═══ */}
      {tagsModal && (
        <Modal
          open
          onClose={() => setTagsModal(false)}
          title="编辑业务标签"
          description="使用 2-8 个词语简述业务方向，每个单独填写，保存后立即生效"
          footer={
            <>
              <button onClick={() => setTagsModal(false)} className="neu-btn-soft">取消</button>
              <button onClick={handleSaveTags} disabled={tagsSaving} className="neu-btn-primary">
                {tagsSaving ? '保存中...' : '保存'}
              </button>
            </>
          }
        >
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {editTags.map((tag, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-[var(--muted-foreground)] min-w-[18px]">{i + 1}.</span>
                <input
                  value={tag}
                  onChange={e => setEditTags(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  placeholder={i === 0 ? '如：办公用品' : i === 1 ? '如：钻机销售' : '请输入业务标签'}
                  maxLength={20}
                  className="neu-input flex-1 text-sm h-9"
                />
                {editTags.length > 2 && (
                  <button onClick={() => setEditTags(prev => prev.filter((_, j) => j !== i))} className="text-[var(--muted-foreground)] hover:text-[var(--danger)] transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="8" x2="20" y2="8"/></svg>
                  </button>
                )}
              </div>
            ))}
            {editTags.length < 8 && (
              <button onClick={() => setEditTags(prev => [...prev, ''])} className="neu-btn-xs w-full justify-center py-1.5 text-[11px] !text-[var(--muted-foreground)]">
                + 添加标签（{editTags.length}/8）
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
