'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/copy-to-clipboard';
import { getExpertPortrait, getExpertEvaluations, getViolations, addViolation, getNotifyPrefs, updateNotifyPrefs, getNotifyHistory, getAiAdoptionRate, proxyMarkExpertInvitation, updateExpertProfile, getRiskBrief, type ExpertPortrait, type ExpertRiskBrief, type NotifyHistoryItem, revealExpertField } from '@/lib/api/expert';
import { Modal, AlertBanner, StatusBadge } from '@/components/workbench';
import { useExpertAlerts } from '@/lib/hooks/use-alerts';
import { TrendingUp, Award, AlertTriangle, ShieldAlert, ShieldCheck, Bell, Phone, MessageSquare, History, Ban, Sparkles, RefreshCw, Pencil, X, User, Hash, Briefcase, GraduationCap, Mail, Building2, Calendar, FileText, IdCard, Users, MapPin, Loader2 } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR, LEVEL_LABEL } from '@water-erp/shared';

interface ScoreRecord { id: string; score: number; reason: string | null; scoreItem: { name: string; category: string; maxScore: number }; }
interface Assignment {
  id: string; expertName: string; major: string; progress: number;
  signedIn: boolean; avoidanceConfirmed: boolean; totalScore: number;
  isLead: boolean; invitationStatus: string;
  // 邀请作答留痕（2026-10-21）：作答方/理由/自答快照（后端 include 全量返回）
  invitationActorType?: 'EXPERT' | 'STAFF' | 'SYSTEM' | null;
  invitationActorName?: string | null;
  invitationReason?: string | null;
  expertRespondedAt?: string | null;
  expertStatus?: 'confirmed' | 'declined' | null;
  invitationTrail?: { action: string; actorType: string; actorName: string | null; fromStatus: string | null; toStatus: string | null; fromRole: string | null; toRole: string | null; reason: string | null; createdAt: string }[];
  project: { id: string; projectCode: string; name: string; stage: string; procurementMethod: string; openTime: string };
  scoreRecords: ScoreRecord[];
}
interface ExpertDetail {
  id: string; username: string; displayName: string; email: string | null;
  department: { id: string; name: string } | null; createdAt: string; isActive: boolean;
  expertProfile?: { specialty?: string; title?: string; employer?: string; phone?: string; idNumber?: string; availability?: string; notes?: string; education?: string; ethnicity?: string; licenseNo?: string; regionCode?: string; expertLevel?: string };
  assignments: Assignment[];
  statistics: { totalProjects: number; completedProjects: number; signedInProjects: number; evalAvg: number; evalCount: number };
  /** 邀请信用摘要（2026-10-21）：毁约记录 + 连拒段预警口径 */
  invitationSummary?: {
    invited: number; confirmed: number; declined: number; pending: number;
    overrideAfterConfirm: number; consecutiveDeclined: number;
    breachEvents: { projectName: string; at: string; reason: string | null; actorName: string | null }[];
  };
}

const STAGE_FALLBACK_COLOR = 'var(--muted-foreground)';
const levelTone: Record<string, 'green' | 'blue' | 'orange' | 'red'> = { A: 'green', B: 'blue', C: 'orange', D: 'orange', E: 'red' };

/** 字段展示卡片支持 ReactNode、空值淡化和点击复制。 */

function InfoField({
  label,
  value,
  mono = false,
  full = false,
  copyable = false,
}: {
  label: React.ReactNode; // 允许 PII 揭示按钮随标签内联
  value?: React.ReactNode;
  mono?: boolean;
  full?: boolean;
  copyable?: boolean;
}) {
  const empty = value == null || (typeof value === 'string' && !value.trim());
  return (
    <div className={`kpi-card group flex min-w-0 flex-col gap-1 px-3.5 py-3 ${full ? 'col-span-full' : ''}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] leading-none text-[var(--muted-foreground)]">{label}</span>
      <div
        className={`break-words text-[13px] font-bold leading-snug tabular-nums text-[var(--foreground)] ${mono ? 'font-mono tracking-tight' : ''} ${empty ? 'font-normal text-[var(--muted-foreground)]/55' : ''} ${copyable && !empty ? 'cursor-pointer transition-colors group-hover:text-[var(--accent)]' : ''}`}
        title={copyable && !empty ? '点击复制' : undefined}
        onClick={copyable && !empty && typeof value === 'string' ? async () => { if (await copyToClipboard(value)) toast.success(`${label} 已复制`); else toast.error('复制失败，请手动选择复制'); } : undefined}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}

/** 分组标题（v3）：accent 竖点 + 粗标签 + hairline */
function FieldGroup({ label }: { label: string }) {
  return (
    <div className="col-span-full mt-2 flex items-center gap-2 first:mt-0">
      <span className="h-3 w-1 rounded-full bg-[var(--accent)]/70" />
      <span className="text-[11px] font-extrabold tracking-[0.1em] text-[color:var(--muted-foreground)]">{label}</span>
      <span className="flex-1 border-t" style={{ borderTopColor: "oklch(0.6 0.04 258 / 0.16)" }} />
    </div>
  );
}

/** 区块标题：小号大写 + 图标 */
function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  return (
    <h3 className="mb-4 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
      <Icon size={13} />{children}
    </h3>
  );
}

type Tab = 'info' | 'overview' | 'timeline' | 'portrait' | 'evaluations' | 'ai-adoption' | 'risk' | 'violations' | 'notify';
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'info', label: '基本信息', icon: User },
  { key: 'overview', label: '评审项目', icon: TrendingUp },
  { key: 'timeline', label: '大事记', icon: Award },
  { key: 'portrait', label: '专家画像', icon: TrendingUp },
  { key: 'evaluations', label: '评价历史', icon: History },
  { key: 'ai-adoption', label: 'AI采纳率', icon: Sparkles },
  { key: 'risk', label: '风险预警', icon: AlertTriangle },
  { key: 'violations', label: '违规记录', icon: ShieldAlert },
  { key: 'notify', label: '通知偏好', icon: Bell },
];

type ProfileFormState = { displayName: string; email: string; specialty: string; title: string; employer: string; departmentName: string; phone: string; idNumber: string; ethnicity: string; education: string; licenseNo: string; availability: '可用' | '占用' | '停用'; notes: string; regionCode: string; expertLevel: string };
const PROFILE_FIELDS: { key: Exclude<keyof ProfileFormState, 'notes' | 'availability' | 'departmentName'>; label: string; placeholder: string }[] = [
  { key: 'displayName', label: '姓名', placeholder: '专家姓名' },
  { key: 'email', label: '邮箱', placeholder: '用于登录与通知触达' },
  { key: 'specialty', label: '专业', placeholder: '如 水利水电工程' },
  { key: 'title', label: '职称', placeholder: '如 高级工程师' },
  { key: 'employer', label: '工作单位', placeholder: '所在单位全称' },
  { key: 'phone', label: '手机', placeholder: '用于短信 / 电话通知' },
  { key: 'idNumber', label: '身份证号', placeholder: '18 位身份证号码' },
  { key: 'ethnicity', label: '民族', placeholder: '如 汉族' },
  { key: 'education', label: '学历', placeholder: '如 硕士研究生' },
  { key: 'licenseNo', label: '证书编号', placeholder: '执业资格证书编号' },
];

export default function ExpertDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expertId = params.id as string;
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  // 邀请代回应/代变更（2026-10-21 留痕通道：替代原无理由直改按钮）
  const [inviteProxy, setInviteProxy] = useState<{ projectId: string; projectName: string; target: 'confirmed' | 'declined'; current: 'pending' | 'confirmed' | 'declined' } | null>(null);
  const [inviteProxyReason, setInviteProxyReason] = useState('');
  const [inviteProxyBusy, setInviteProxyBusy] = useState(false);
  const submitInviteProxy = async () => {
    if (!inviteProxy) return;
    if (inviteProxyReason.trim().length < 5) { toast.error('请填写理由（至少 5 个字）'); return; }
    setInviteProxyBusy(true);
    try {
      const r = await proxyMarkExpertInvitation(inviteProxy.projectId, expertId, inviteProxy.target, inviteProxyReason.trim());
      toast.success(r.changed ? (inviteProxy.target === 'confirmed' ? '已代为确认' : '已代为婉拒') : '状态未变化（同状态幂等）');
      setInviteProxy(null); setInviteProxyReason('');
      reload();
    } catch (e: any) { toast.error(e?.message || '操作失败'); }
    finally { setInviteProxyBusy(false); }
  };
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('expert-detail-tab') as Tab) || 'info';
    }
    return 'info';
  });
  const setTab = (t: Tab) => { setTabState(t); try { sessionStorage.setItem('expert-detail-tab', t); } catch {} };
  const [tabLoading, setTabLoading] = useState(false);
  const loadedTabsRef = useRef<Set<Tab>>(new Set(['overview']));

  // Sub-data
  const [portrait, setPortrait] = useState<ExpertPortrait | null>(null);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [violations, setViolations] = useState<any[]>([]);
  const [notifyPrefs, setNotifyPrefs] = useState({ inApp: true, sms: false, phone: false });
  const [notifyHistory, setNotifyHistory] = useState<NotifyHistoryItem[]>([]);
  // AI 采纳率
  const [aiAdoption, setAiAdoption] = useState<any>(null);
  const [risk, setRisk] = useState<ExpertRiskBrief | null>(null);
  const [riskError, setRiskError] = useState('');
  // Tab 失败态：区分「加载中 / 出错 / 真空」，出错不记缓存、可重试
  const [tabError, setTabError] = useState<Partial<Record<Tab, boolean>>>({});
  const [tabReload, setTabReload] = useState(0);
  // Violation form
  const [showViolationForm, setShowViolationForm] = useState(false);
  const [vioType, setVioType] = useState('');
  const [vioDetail, setVioDetail] = useState('');
  const [vioSeverity, setVioSeverity] = useState<'warning' | 'danger'>('warning');
  const [vioSaving, setVioSaving] = useState(false);
  // 编辑资料弹窗
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<ProfileFormState>({ displayName: '', email: '', specialty: '', title: '', employer: '', departmentName: '', phone: '', idNumber: '', ethnicity: '', education: '', licenseNo: '', availability: '可用', notes: '', regionCode: '', expertLevel: '' });
  // PII 明文揭示（等保+密评）：详情默认掩码；点「明文」调 reveal 端点（后端 SensitiveAccessLog 留痕）
  const [revealedPii, setRevealedPii] = useState<Record<string, string>>({});
  const [revealingPii, setRevealingPii] = useState<string | null>(null);
  const toggleRevealPii = async (field: 'idNumber' | 'phone' | 'email') => {
    if (revealedPii[field] !== undefined) {
      setRevealedPii(prev => { const n: Record<string, string> = { ...prev }; delete n[field]; return n; });
      return;
    }
    setRevealingPii(field);
    try {
      const r = await revealExpertField(expertId, field);
      const v = r.value;
      if (v) { setRevealedPii(prev => ({ ...prev, [field]: v })); toast.success('已揭示（本次揭示已留审计日志）'); }
      else toast.error('该字段暂无值');
    } catch (e: any) { toast.error(e?.message || '揭示失败'); }
    setRevealingPii(null);
  };
  const PiiRevealBtn = ({ field }: { field: 'idNumber' | 'phone' | 'email' }) => (
    <button onClick={() => toggleRevealPii(field)} disabled={revealingPii === field}
      className="neu-btn-xs is-ghost ml-1.5 !px-2 !py-0.5 !text-[10px] shrink-0" title="揭示明文（写入审计日志）">
      {revealingPii === field ? '…' : revealedPii[field] !== undefined ? '复原' : '明文'}
    </button>
  );
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    setLoading(true); setLoadError(false);
    api.get<ExpertDetail>(`/expert-admin/${expertId}`)
      .then(d => { setExpert(d); })
      .catch(() => { setLoadError(true); toast.error('加载专家详情失败'); })
      .finally(() => setLoading(false));
  }, [expertId]);

  const reload = () => {
    setLoading(true); setLoadError(false);
    api.get<ExpertDetail>(`/expert-admin/${expertId}`)
      .then(d => setExpert(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  const expertAlerts = useExpertAlerts(expertId);
  const alertItems = [
    ...(expertAlerts.consecutiveE ? [{ severity: 'red' as const, title: '连续 2 次 E 级评价', detail: '该专家近期履职评价连续不合格，建议关注' }] : []),
    ...(expertAlerts.overloaded ? [{ severity: 'orange' as const, title: '评审负荷过载', detail: `同时参与 ${expertAlerts.activeProjectCount} 个未归档项目，超过 3 个上限` }] : []),
  ];

  // Load tab data（首次进入某 Tab 显示加载态；已缓存则直接复用，避免闪烁）
  // 仅成功的 tab 记入缓存；失败的 tab 不记缓存（切回时可重拉）并标记错误态，避免一次网络抖动导致永久"假空"
  useEffect(() => {
    if (loadedTabsRef.current.has(tab)) { setTabLoading(false); return; }
    setTabLoading(true);
    setTabError(prev => (prev[tab] ? { ...prev, [tab]: false } : prev));
    let failed = false;
    const track = (p: Promise<unknown>) => p.catch(() => { failed = true; });
    const tasks: Promise<unknown>[] = [];
    if (tab === 'portrait') tasks.push(track(getExpertPortrait(expertId).then(setPortrait)));
    if (tab === 'evaluations') tasks.push(track(getExpertEvaluations(expertId).then(setEvaluations)));
    if (tab === 'timeline') { tasks.push(track(getExpertEvaluations(expertId).then(setEvaluations))); tasks.push(track(getViolations(expertId).then(setViolations))); }
    if (tab === 'violations') tasks.push(track(getViolations(expertId).then(setViolations)));
    if (tab === 'ai-adoption') tasks.push(track(getAiAdoptionRate(expertId).then(setAiAdoption)));
    if (tab === 'risk') tasks.push(track(getRiskBrief(expertId).then(setRisk).catch((e: any) => { setRiskError(e?.message || '风险简报生成失败'); throw e; })));
    if (tab === 'notify') { tasks.push(track(getNotifyPrefs(expertId).then(setNotifyPrefs))); tasks.push(track(getNotifyHistory(expertId).then(setNotifyHistory))); }
    Promise.all(tasks).finally(() => {
      setTabLoading(false);
      if (failed) setTabError(prev => ({ ...prev, [tab]: true }));
      else loadedTabsRef.current = new Set(loadedTabsRef.current).add(tab);
    });
  }, [tab, expertId, tabReload]);

  // Tab 加载失败重试：清除该 tab 缓存与错误态，触发重拉
  const retryTab = (t: Tab) => {
    loadedTabsRef.current = new Set([...loadedTabsRef.current].filter(x => x !== t));
    if (t === 'risk') { setRisk(null); setRiskError(''); }
    setTabReload(n => n + 1);
  };

  // 切换专家时重置 Tab 缓存与子数据，避免展示上一位专家的旧数据
  useEffect(() => {
    loadedTabsRef.current = new Set(['overview']);
    setTabError({});
    setPortrait(null); setEvaluations([]); setViolations([]); setAiAdoption(null);
    setRisk(null); setRiskError('');
  }, [expertId]);

  const submitViolation = async () => {
    if (!vioType.trim() || !vioDetail.trim()) return;
    setVioSaving(true);
    try {
      await addViolation(expertId, { type: vioType.trim(), detail: vioDetail.trim(), severity: vioSeverity });
      toast.success('违规记录已添加');
      setShowViolationForm(false); setVioType(''); setVioDetail('');
      getViolations(expertId).then(setViolations).catch(() => {});
    } catch (e: any) { toast.error(e?.message || '添加失败'); }
    setVioSaving(false);
  };

  const saveNotifyPrefs = async () => {
    try {
      await updateNotifyPrefs(expertId, notifyPrefs);
      toast.success('通知偏好已保存');
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
  };

  const openEditProfile = () => {
    if (!expert) return;
    const p = expert.expertProfile;
    // PII 字段不回填（详情值为掩码，回填保存会把掩码串写回库）——留空=保持不变
    setEditForm({
      displayName: expert.displayName || '',
      email: '',
      specialty: p?.specialty || '',
      title: p?.title || '',
      employer: p?.employer || '',
      departmentName: expert.department?.name || '',
      phone: '',
      idNumber: '',
      ethnicity: p?.ethnicity || '',
      education: p?.education || '',
      licenseNo: '',
      availability: (p?.availability as '可用' | '占用' | '停用') || '可用',
      notes: p?.notes || '',
      regionCode: p?.regionCode || '',
      expertLevel: p?.expertLevel || '',
    });
    setShowEditModal(true);
  };

  const saveProfile = async () => {
    // 保存前校验：姓名/专业必填；手机/身份证/邮箱填了才查格式（正则与录入页一致）
    if (!editForm.displayName.trim()) { toast.error('请输入专家姓名'); return; }
    if (!editForm.specialty.trim()) { toast.error('请输入专业领域'); return; }
    if (editForm.phone.trim() && !/^1[3-9]\d{9}$/.test(editForm.phone.trim())) { toast.error('手机号格式不正确（11位数字）'); return; }
    if (editForm.idNumber.trim() && !/^\d{17}[\dXx]$/.test(editForm.idNumber.trim())) { toast.error('身份证号格式不正确（18位）'); return; }
    if (editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) { toast.error('邮箱格式不正确'); return; }
    if (editForm.regionCode.trim() && !/^\d{6}$/.test(editForm.regionCode.trim())) { toast.error('区域代码格式不正确（六位数字，如 510000）'); return; }
    setEditSaving(true);
    try {
      // A-129 档案维度：空值提交 null=显式清除（后端 null 语义），清空保存即清除
      // PII（email/phone/idNumber/licenseNo）留空=不修改：剥离空值（后端 undefined 即跳过）
      const { email, phone, idNumber, licenseNo, ...rest } = editForm;
      const payload: Record<string, unknown> = { ...rest, regionCode: editForm.regionCode.trim() || null, expertLevel: editForm.expertLevel || null };
      if (email.trim()) payload.email = email.trim();
      if (phone.trim()) payload.phone = phone.trim();
      if (idNumber.trim()) payload.idNumber = idNumber.trim();
      if (licenseNo.trim()) payload.licenseNo = licenseNo.trim();
      await updateExpertProfile(expertId, payload as Parameters<typeof updateExpertProfile>[1]);
      toast.success('专家资料已保存');
      setShowEditModal(false);
      reload();
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    setEditSaving(false);
  };

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      <div className="skeleton h-5 w-24 rounded" />
      <div className="space-y-2"><div className="skeleton h-7 w-48 rounded" /><div className="skeleton h-3 w-32 rounded" /></div>
    </div>
  );
  if (loadError) return (
    <div className="py-24 text-center">
      <p className="text-sm font-semibold text-[var(--danger)] mb-3">专家详情加载失败</p>
      <button onClick={reload} className="neu-btn-xs is-info">重试</button>
    </div>
  );
  if (!expert) return <div className="py-24 text-center text-[13px] text-[var(--muted-foreground)]">专家不存在</div>;

  // 编号优先取名单带来的（藏在 notes 里 "编号: A001431, ..."）；无编号者按「入库年月+ID 尾 6 位」
  // 派生稳定唯一展示号（2026-10-22 用户口径：详情右侧展示编号+入库时间，全量专家都有编号）
  const parsedNo = expert.expertProfile?.notes?.match(/编号\s*[:：]\s*([^\s,，、]+)/)?.[1];
  const entryAt = expert.expertProfile?.verifiedAt ?? expert.createdAt;
  const entryDate = new Date(entryAt);
  const derivedNo = `ZJ-${String(entryDate.getFullYear()).slice(2)}${String(entryDate.getMonth() + 1).padStart(2, '0')}-${expert.id.slice(-6).toUpperCase()}`;
  const expertNo = parsedNo ?? derivedNo;

  return (
    <div className="flex flex-col gap-5">
      {/* 返回按钮 + page-hero */}
      <button onClick={() => router.push('/expert/repository')} className="flow-back shrink-0 self-start">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        返回专家库
      </button>

      {alertItems.length > 0 && <AlertBanner items={alertItems} />}

      {/* Header — page-hero（合并标题 + KPI） */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Award size={17} /></div>
            <div className="min-w-0">
              <div className="page-hero__title truncate">
                {expert.displayName}
              </div>
              <div className="page-hero__sub truncate">
                {expert.expertProfile?.specialty && <span>{expert.expertProfile.specialty}</span>}
                {expert.expertProfile?.title && <span className="ml-2">· {expert.expertProfile.title}</span>}
                {expert.expertProfile?.employer && <span className="ml-2">· {expert.expertProfile.employer}</span>}
                {expert.expertProfile?.education && <span className="ml-2">· {expert.expertProfile.education}</span>}
                {expert.expertProfile?.licenseNo && <span className="ml-2">· 执业资格: {expert.expertProfile.licenseNo}</span>}
              </div>
            </div>
          </div>
          <div className="page-hero__right">
            {/* 特有编号 + 入库时间（2026-10-22 用户口径）：右侧常驻；入库取审核留痕时间，无则账号建档时间 */}
            <span
              className="rounded-[8px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2 py-1 font-mono text-[11px] font-bold tracking-wide text-[var(--accent)]"
              title={parsedNo ? `专家编号：${parsedNo}` : '系统派生编号（名单未带编号，按入库年月+ID 生成，稳定唯一）'}
            >
              编号 {expertNo}
            </span>
            <span
              className="rounded-[8px] bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] px-2 py-1 text-[11px] font-semibold tabular-nums text-[color:var(--muted-foreground)]"
              title={`入库时间：${entryDate.toLocaleString('zh-CN')}`}
            >
              入库 {entryDate.toLocaleDateString('zh-CN')}
            </span>
            <StatusBadge tone={expert.isActive ? 'green' : 'gray'}>{expert.isActive ? '可用' : '已停用'}</StatusBadge>
            {portrait?.isStandingExpert && <StatusBadge tone="purple">常委专家</StatusBadge>}
            <button onClick={openEditProfile} className="neu-btn-soft"><Pencil size={14} /> 编辑资料</button>
          </div>
        </div>

        {/* KPI 瓷片行 —— 融入 page-hero */}
        <div className="page-hero__divider">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['参评项目', expert.statistics.totalProjects],
              ['已完成', expert.statistics.completedProjects],
              ['已签到', expert.statistics.signedInProjects],
              ['评价均分', expert.statistics.evalAvg ? `${expert.statistics.evalAvg}分` : '—'],
              ['获评次数', expert.statistics.evalCount],
            ].map(([label, value]) => (
              <div key={label} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
                <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tab 导航 —— 融入 page-hero 底部 */}
        <div className="page-hero__divider !pt-3">
          <div className="neu-tab-bar">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => {
                  if (!loadedTabsRef.current.has(t.key)) setTabLoading(true);
                  setTab(t.key);
                }}
                className={`neu-tab ${tab === t.key ? 'is-active' : ''}`}
              >
                <t.icon size={14} /><span className="ml-1.5">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'info' && expert && (() => {
        const p = expert.expertProfile || {};
        const availabilityTone = p.availability === '可用' ? 'green' : p.availability === '占用' ? 'orange' : 'gray';
        return (
          <div className="space-y-5">
            {/* 职业信息 */}
            <section className="neu-card-static !rounded-2xl p-5">
              <SectionTitle icon={Briefcase}>职业信息</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <InfoField label="专业领域" value={p.specialty} />
                <InfoField label="职称" value={p.title} />
                <InfoField label="学历" value={p.education} />
                <InfoField label="执业资格编号" value={p.licenseNo} mono copyable />
                <InfoField label="行政区域代码" value={p.regionCode} mono />
                <InfoField label="库内等级" value={p.expertLevel ? `${p.expertLevel} 级` : undefined} />
              </div>
              {/* 工作单位 + 所属部门 成对相邻 */}
              <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-[var(--border)] pt-4 md:grid-cols-2">
                <InfoField label="工作单位" value={p.employer} />
                <InfoField label="所属部门" value={expert.department?.name} />
              </div>
            </section>

            {/* 身份与联系（2026-09-18 v3 合并为单卡分组瓷片） */}
            <section className="neu-card-static !rounded-2xl p-5">
              <SectionTitle icon={IdCard}>身份与联系</SectionTitle>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                <FieldGroup label="身份" />
                <InfoField label="姓名" value={expert.displayName} />
                <InfoField label={<span className="inline-flex items-center">身份证号<PiiRevealBtn field="idNumber" /></span>} value={revealedPii.idNumber ?? p.idNumber} mono />
                <InfoField label="民族" value={p.ethnicity} />
                <FieldGroup label="联系" />
                <InfoField label={<span className="inline-flex items-center">手机号码<PiiRevealBtn field="phone" /></span>} value={revealedPii.phone ?? p.phone} mono />
                <InfoField label={<span className="inline-flex items-center">邮箱<PiiRevealBtn field="email" /></span>} value={revealedPii.email ?? expert.email} />
                <InfoField label="可用状态" value={p.availability ? <StatusBadge tone={availabilityTone as any}>{p.availability}</StatusBadge> : null} />
              </div>
            </section>

            {/* 账户与归属 */}
            <section className="neu-card-static !rounded-2xl p-5">
              <SectionTitle icon={Building2}>账户与归属</SectionTitle>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                <InfoField label="登录用户名" value={expert.username} mono copyable />
                <InfoField label="账户状态" value={<StatusBadge tone={expert.isActive ? 'green' : 'gray'}>{expert.isActive ? '正常' : '已停用'}</StatusBadge>} />
              </div>
              {p.notes && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <InfoField label="履职备注" value={p.notes} full />
                </div>
              )}
            </section>

            {/* 系统元信息 footer */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-[var(--muted-foreground)]">
              <span className="inline-flex items-center gap-1"><Calendar size={11} /> 入库于 {new Date(expert.createdAt).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        );
      })()}

      {tab === 'overview' && expert.invitationSummary && (
        <div className="neu-card-static !rounded-2xl mb-4 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={15} className="text-[var(--accent)]" />
            <h3 className="text-sm font-bold text-[var(--foreground)]">邀请信用</h3>
            {(expert.invitationSummary.consecutiveDeclined ?? 0) >= 3 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ color: '#e74c3c', background: '#fef2f2', border: '1px solid #fecaca' }}>
                <AlertTriangle size={11} />连续婉拒预警
              </span>
            )}
            {expert.invitationSummary.overrideAfterConfirm > 0 && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ color: 'var(--danger)', background: 'color-mix(in oklch, var(--danger) 10%, transparent)' }}>
                邀请毁约 {expert.invitationSummary.overrideAfterConfirm} 次
              </span>
            )}
          </div>
          {(expert.invitationSummary.consecutiveDeclined ?? 0) >= 3 && (
            <div className="mb-3 flex items-start gap-2.5 rounded-xl border px-4 py-3"
              style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#e74c3c]" />
              <div className="min-w-0 text-[12px] leading-5 text-[var(--foreground)]">
                该专家已连续 {expert.invitationSummary.consecutiveDeclined} 次拒绝评审邀请（阈值 3 次，含婉拒/超时弃权/代婉拒）。请复核其参评意愿与库内状态——系统已同步通知 leader 与 staff。
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {([
              ['累计受邀', expert.invitationSummary.invited],
              ['确认参加', expert.invitationSummary.confirmed],
              ['婉拒/弃权', expert.invitationSummary.declined],
              ['中途毁约', expert.invitationSummary.overrideAfterConfirm],
              ['连续拒绝', expert.invitationSummary.consecutiveDeclined],
            ] as [string, number][]).map(([label, value]) => (
              <div key={label} className="rounded-[10px] px-3 py-2 text-center"
                style={{
                  background: (label === '连续拒绝' && value >= 3) || (label === '中途毁约' && value > 0)
                    ? 'color-mix(in oklch, var(--danger) 7%, transparent)'
                    : 'oklch(1 0 0 / 0.45)',
                }}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">{label}</div>
                <div className="text-[1.3rem] font-black tabular-nums leading-tight"
                  style={{ color: (label === '连续拒绝' && value >= 3) || (label === '中途毁约' && value > 0) ? 'var(--danger)' : 'var(--foreground)' }}>{value}</div>
              </div>
            ))}
          </div>
          {(expert.invitationSummary.breachEvents?.length ?? 0) > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">邀请毁约记录（确认参加后被改为拒绝）</div>
              {expert.invitationSummary.breachEvents!.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-3 py-2"
                  style={{ background: 'color-mix(in oklch, var(--danger) 5%, transparent)' }}>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--foreground)]">{b.projectName || '（项目已清理）'}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums">{new Date(b.at).toLocaleString('zh-CN')}</span>
                  {b.actorName && <span className="text-[11px] text-[var(--muted-foreground)]">操作人 {b.actorName}</span>}
                  {b.reason && <span className="w-full text-[11px] text-[var(--danger)]">理由：{b.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'overview' && (
        <div className="neu-table-card">
          <div className="overflow-hidden">
            {expert.assignments.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">暂无评审项目记录</div>
            ) : expert.assignments.map((a, i) => {
              const stageColor = STAGE_COLOR[a.project.stage] || STAGE_FALLBACK_COLOR;
              return (
                <div key={a.id} className={`px-5 py-4 ${i < expert.assignments.length - 1 ? 'border-b border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]' : ''}`}>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-extrabold text-[var(--foreground)] truncate">{a.project.name}</h3>
                      <p className="text-[12px] text-[var(--muted-foreground)] mt-0.5">{a.project.projectCode} · {a.project.procurementMethod}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold flex-shrink-0 rounded-full" style={{ color: stageColor, background: `color-mix(in oklch, ${stageColor} 10%, transparent)` }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: stageColor }} />{STAGE_LABEL[a.project.stage] || a.project.stage}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {a.isLead && <StatusBadge tone="purple">组长</StatusBadge>}
                    {a.invitationStatus === 'pending' && <><StatusBadge tone="blue">待确认</StatusBadge>
                      {/* 2026-10-21 口径统一：原无痕直改按钮收编为留痕代回应（必填理由） */}
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setInviteProxy({ projectId: a.project.id, projectName: a.project.name, target: 'confirmed', current: 'pending' }); setInviteProxyReason(''); }}
                        className="neu-btn-xs is-success"
                      >代确认</button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setInviteProxy({ projectId: a.project.id, projectName: a.project.name, target: 'declined', current: 'pending' }); setInviteProxyReason(''); }}
                        className="neu-btn-xs is-danger"
                      >代婉拒</button>
                    </>}
                    {a.invitationStatus !== 'pending' && (
                      <button
                        onClick={(ev) => { ev.stopPropagation(); setInviteProxy({ projectId: a.project.id, projectName: a.project.name, target: a.invitationStatus === 'confirmed' ? 'declined' : 'confirmed', current: a.invitationStatus as 'confirmed' | 'declined' }); setInviteProxyReason(''); }}
                        className="neu-btn-xs"
                        title="工作人员代为变更邀请（必填理由，全程留痕）"
                      >代为变更</button>
                    )}
                    {a.invitationStatus === 'confirmed' && <StatusBadge tone="green">已确认</StatusBadge>}
                    {a.invitationStatus === 'declined' && <StatusBadge tone="red">{a.invitationActorType === 'SYSTEM' ? '已拒绝（超时弃权）' : '已拒绝'}</StatusBadge>}
                    {a.invitationActorType === 'STAFF' && (
                      <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: 'color-mix(in oklch, var(--warning) 14%, transparent)', color: 'var(--warning)' }}>
                        工作人员代回应{a.invitationActorName ? ` · ${a.invitationActorName}` : ''}
                      </span>
                    )}
                  </div>
                  {(a.invitationReason || (a.invitationActorType === 'STAFF' && a.expertRespondedAt)) && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {a.invitationActorType === 'STAFF' && a.expertRespondedAt && (
                        <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                          专家自答于 {new Date(a.expertRespondedAt).toLocaleString('zh-CN')}（原{a.expertStatus === 'confirmed' ? '确认参加' : '婉拒'}），后经代变更
                        </span>
                      )}
                      {a.invitationReason && (
                        <span className="max-w-full truncate rounded-[6px] px-2 py-1 text-[11px] font-semibold"
                          style={{ background: 'color-mix(in oklch, var(--warning) 9%, transparent)', color: 'var(--foreground)' }}
                          title={`代回应理由：${a.invitationReason}`}>
                          <span className="text-[var(--muted-foreground)] font-bold">代回应理由：</span>{a.invitationReason}
                        </span>
                      )}
                    </div>
                  )}
                  {/* 邀请全量轨迹（2026-10-21 用户口径：理由全量记录——每次流转的时刻/操作人/理由逐条可查） */}
                  {(a.invitationTrail?.length ?? 0) > 0 && (
                    <div className="mb-3 rounded-[10px] px-3 py-2"
                      style={{ background: 'color-mix(in oklch, var(--muted-foreground) 4%, transparent)' }}>
                      <div className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">邀请轨迹</div>
                      <div className="space-y-0.5">
                        {a.invitationTrail!.map((t, i) => (
                          <div key={i} className="flex flex-wrap items-start gap-x-2 text-[11px] leading-5">
                            <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{new Date(t.createdAt).toLocaleString('zh-CN')}</span>
                            <span className="shrink-0 font-bold text-[var(--foreground)]">
                              {({ RESPONDED: '专家自答', AUTO_DECLINED: '超时自动弃权', STAFF_MARKED: '工作人员代回应/变更', PROMOTED: '递补转正', SWAP_OUT: '替换换出', SWAP_IN: '替换换入' } as Record<string, string>)[t.action] ?? t.action}
                              {t.actorType === 'STAFF' ? `（${t.actorName || '工作人员'}）` : ''}
                              {t.fromStatus && t.toStatus && t.fromStatus !== t.toStatus ? `：${t.fromStatus === 'confirmed' ? '确认参加' : t.fromStatus === 'declined' ? '无法参加' : '待回复'} → ${t.toStatus === 'confirmed' ? '确认参加' : '无法参加'}` : ''}
                              {t.fromRole && t.toRole && t.fromRole !== t.toRole ? ` · ${t.fromRole}→${t.toRole}` : ''}
                            </span>
                            {t.reason && <span className="min-w-0 flex-1 text-[var(--warning)]">理由：{t.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-3 text-[12px] text-[var(--muted-foreground)] mb-3">
                    <span>专业：<strong className="text-[var(--foreground)]">{a.major || '—'}</strong></span>
                    <span>签到：<strong className={a.signedIn ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}>{a.signedIn ? '已签到' : '未签到'}</strong></span>
                    <span>回避：<strong className={a.avoidanceConfirmed ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}>{a.avoidanceConfirmed ? '已确认' : '未确认'}</strong></span>
                    <span>总分：<strong className="text-[var(--foreground)] tabular-nums">{Number(a.totalScore)}</strong></span>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-[var(--muted-foreground)]">
                    <span className="tabular-nums font-bold text-[var(--foreground)]">{a.progress}%</span>
                    <span>评分记录 {a.scoreRecords.length} 条</span>
                    <div className="flex-1 h-1.5 bg-[color-mix(in_oklch,var(--muted)_50%,transparent)] overflow-hidden rounded-full">
                      <div className="h-full bg-[var(--accent)] transition-all duration-500 rounded-full" style={{width: `${a.progress}%`}} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'timeline' && (() => {
        const timelineEvents: { time: string; type: string; title: string; detail: string; tone: 'accent' | 'green' | 'orange' | 'red' | 'gray' }[] = [];

        // 1. 注册
        timelineEvents.push({ time: new Date(expert.createdAt).toISOString(), type: '入库', title: '加入专家库', detail: `以「${expert.expertProfile?.specialty || ''}」专业入库`, tone: 'accent' });

        // 2. 评审项目分配
        for (const a of expert.assignments) {
          timelineEvents.push({
            time: a.project.openTime || a.id,
            type: '项目分配',
            title: `参与评审「${a.project.name}」`,
            detail: `专业:${a.major} · 状态:${STAGE_LABEL[a.project.stage] || a.project.stage} · 进度:${a.progress}% · 得分:${Number(a.totalScore)}`,
            tone: a.progress >= 100 ? 'green' : 'orange',
          });
        }

        // 3. 评价记录
        for (const ev of evaluations) {
          timelineEvents.push({
            time: ev.createdAt,
            type: '履职评价',
            title: `${LEVEL_LABEL[ev.overallGrade] || ev.overallGrade}级`,
            detail: `出勤${ev.attendanceGrade || '—'}/质量${ev.qualityGrade || '—'}/廉洁${ev.disciplineGrade || '—'} · 评价人:${ev.evaluator?.displayName || '—'}${ev.comment ? ' · ' + ev.comment : ''}`,
            tone: ev.overallGrade === 'A' ? 'green' : ev.overallGrade === 'B' ? 'accent' : ev.overallGrade === 'E' ? 'red' : ev.overallGrade === 'D' ? 'orange' : 'orange',
          });
        }

        // 4. 违规记录
        for (const v of violations) {
          const d = v.details || {};
          timelineEvents.push({
            time: v.createdAt,
            type: '违规记录',
            title: d.type || '违规',
            detail: `${d.detail || ''} · 严重程度:${d.severity === 'danger' ? '严重' : '警告'} · 记录人:${v.user?.displayName || '系统'}`,
            tone: d.severity === 'danger' ? 'red' : 'orange',
          });
        }

        timelineEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

        const toneColors: Record<string, string> = { accent: 'var(--accent)', green: 'var(--success)', orange: 'var(--warning)', red: 'var(--danger)', gray: 'var(--muted-foreground)' };
        const typeIcons: Record<string, string> = { '入库': '●', '项目分配': '◉', '履职评价': '◆', '违规记录': '▲' };

        return timelineEvents.length === 0 ? (
          <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">暂无大事记数据</div>
        ) : (
          <div className="neu-table-card p-5">
            <div className="relative pl-6 border-l-2 border-[var(--muted)]/20 space-y-4">
              {timelineEvents.map((ev, i) => (
                <div key={i} className="relative">
                  <span className="absolute left-[-1.35rem] top-1 text-[10px]" style={{ color: toneColors[ev.tone] }}>{typeIcons[ev.type] || '●'}</span>
                  <div className="text-[10px] text-[var(--muted-foreground)]/60 tabular-nums mb-0.5">
                    {new Date(ev.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge tone={ev.tone === 'accent' ? 'blue' : ev.tone as any}>{ev.type}</StatusBadge>
                    <span className="text-sm font-bold text-[var(--foreground)]">{ev.title}</span>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5 leading-relaxed">{ev.detail}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {tab === 'portrait' && portrait && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['参与项目', `${portrait.participationCount} 个`],
              ['完成率', `${Math.round(portrait.completionRate * 100)}%`],
              ['A 级次数', portrait.gradeCounts?.A != null ? `${portrait.gradeCounts.A} 次` : '—'],
              ['常委资格', portrait.isStandingExpert ? '是' : '否'],
              ['评分偏离度', portrait.meanDeviation != null ? `${portrait.meanDeviation > 0 ? '+' : ''}${portrait.meanDeviation}` : '—'],
              ['偏离样本', `${portrait.deviationSamples} 条`],
              ['获评次数', `${portrait.evalCount} 次`],
            ].map(([label, value]) => (
              <div key={label} className="kpi-card flex flex-col gap-1 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
                <span className="text-[1.35rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{value}</span>
              </div>
            ))}
          </div>
          {portrait.recentLevels.length > 0 && (
            <div className="neu-table-card p-4">
              <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">近期评价等级趋势</span>
              <div className="flex items-center gap-1.5 mt-3">
                {portrait.recentLevels.map((lv, i) => (
                  <StatusBadge key={i} tone={levelTone[lv] || 'gray'}>{LEVEL_LABEL[lv] || lv}</StatusBadge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {tab === 'portrait' && !portrait && !tabError.portrait && (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载画像数据中...</div>
      )}
      {tab === 'portrait' && tabError.portrait && (
        <div className="neu-table-card py-14 text-center">
          <p className="text-sm font-semibold text-[var(--danger)] mb-3">加载画像数据失败</p>
          <button onClick={() => retryTab('portrait')} className="neu-btn-xs is-info"><RefreshCw size={12} />重试</button>
        </div>
      )}

      {tab === 'risk' && risk && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['评分偏离度', risk.signals.meanDeviation != null ? `${risk.signals.meanDeviation > 0 ? '+' : ''}${risk.signals.meanDeviation}` : '—'],
              ['偏离风险', risk.signals.deviationRisk === 'high' ? '高' : risk.signals.deviationRisk === 'medium' ? '中' : '低'],
              ['近期E级评价', `${risk.signals.recentECount} 次`],
              ['违规记录', `${risk.signals.violationCount} 条`],
            ].map(([label, value]) => (
              <div key={label} className="kpi-card flex flex-col gap-1 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
                <span className="text-[1.35rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{value}</span>
              </div>
            ))}
          </div>
          <div className="neu-table-card p-4 space-y-2">
            <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">风险简报{risk.aiBrief ? '（AI 生成）' : '（规则判定）'}</span>
            <p className="text-sm leading-relaxed text-[var(--foreground)]">{risk.aiBrief || risk.ruleBrief}</p>
            {risk.aiBrief && <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">规则分析：{risk.ruleBrief}</p>}
          </div>
        </div>
      )}
      {tab === 'risk' && !risk && !riskError && (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">正在生成风险简报...</div>
      )}
      {tab === 'risk' && riskError && (
        <div className="neu-table-card py-14 text-center">
          <p className="text-sm font-semibold text-[var(--danger)] mb-3">{riskError}</p>
          <button onClick={() => retryTab('risk')} className="neu-btn-xs is-info"><RefreshCw size={12} />重试</button>
        </div>
      )}

      {tab === 'evaluations' && (
        <div className="neu-table-card">
          {tabLoading ? (
            <div className="py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载中...</div>
          ) : tabError.evaluations ? (
            <div className="py-14 text-center">
              <p className="text-sm font-semibold text-[var(--danger)] mb-3">加载失败，点击重试</p>
              <button onClick={() => retryTab('evaluations')} className="neu-btn-xs is-info"><RefreshCw size={12} />重试</button>
            </div>
          ) : evaluations.length === 0 ? (
            <div className="py-14 text-center text-sm text-[var(--muted-foreground)]">暂无评价记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[600px]">
                <thead>
                  <tr>
                    <th>评价时间</th>
                    <th className="text-center">出勤</th>
                    <th className="text-center">质量</th>
                    <th className="text-center">廉洁</th>
                    <th className="text-center">综合</th>
                    <th className="text-center">等级</th>
                    <th>评价人</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map((ev: any) => (
                    <tr key={ev.id}>
                      <td className="text-xs tabular-nums text-[var(--muted-foreground)]">{new Date(ev.createdAt).toLocaleDateString('zh-CN')}</td>
                      <td className="text-center"><StatusBadge tone={levelTone[ev.attendanceGrade] || 'gray'}>{ev.attendanceGrade || '—'}</StatusBadge></td>
                      <td className="text-center"><StatusBadge tone={levelTone[ev.qualityGrade] || 'gray'}>{ev.qualityGrade || '—'}</StatusBadge></td>
                      <td className="text-center"><StatusBadge tone={levelTone[ev.disciplineGrade] || 'gray'}>{ev.disciplineGrade || '—'}</StatusBadge></td>
                      <td className="text-center"><StatusBadge tone={levelTone[ev.overallGrade] || 'gray'}>{ev.overallGrade || '—'}</StatusBadge></td>
                      <td className="text-center"><StatusBadge tone={levelTone[ev.overallGrade] || 'gray'}>{LEVEL_LABEL[ev.overallGrade] || ev.overallGrade || '—'}</StatusBadge></td>
                      <td className="text-xs text-[var(--muted-foreground)]">{ev.evaluator?.displayName || '—'}</td>
                      <td className="text-xs text-[var(--muted-foreground)] max-w-[220px]">
                        {(() => {
                          const evd = (ev.evidence ?? {}) as Record<string, string>;
                          const evdText = ['attendanceGrade', 'qualityGrade', 'disciplineGrade']
                            .map(k => { const v = (evd[k] || '').trim(); return v ? (k === 'attendanceGrade' ? '出勤' : k === 'qualityGrade' ? '质量' : '廉洁') + '：' + v : ''; })
                            .filter(Boolean).join('；');
                          const full = [ev.comment, evdText].filter(Boolean).join(' ｜ ');
                          return <span className="block truncate" title={full || undefined}>{full || '—'}</span>;
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ai-adoption' && (
        tabLoading ? <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载中...</div> :
        tabError['ai-adoption'] ? (
          <div className="neu-table-card py-14 text-center">
            <p className="text-sm font-semibold text-[var(--danger)] mb-3">加载失败，点击重试</p>
            <button onClick={() => retryTab('ai-adoption')} className="neu-btn-xs is-info"><RefreshCw size={12} />重试</button>
          </div>
        ) :
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['评分记录', aiAdoption?.overall?.total ?? 0, '参与评分项数'],
              ['AI采纳', aiAdoption?.overall?.accepted ?? 0, '与AI建议一致'],
              ['采纳率', `${aiAdoption?.overall?.adoptionRate ?? 0}%`, '与 AI 建议一致比例'],
              ['平均偏离', aiAdoption?.overall?.total > 0 ? '±' + Math.round(aiAdoption?.byExpert?.find((e: any) => e.expertId === expertId)?.avgAbsDelta || 0) : '—', '偏离度绝对值'],
            ].map(([label, value, sub]) => (
              <div key={label} className="kpi-card flex flex-col gap-1 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{label}</span>
                <span className="text-[1.35rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{String(value)}</span>
                <span className="text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>
              </div>
            ))}
          </div>
          {!aiAdoption || aiAdoption.overall.total === 0 ? (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">该专家暂无AI评分对比数据</div>
          ) : (
            <div className="neu-table-card p-4">
              <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">说明</span>
              <p className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed">
                AI 采纳率反映专家评分与 AI 建议分的一致程度（偏差 ±10% 内视为一致），仅作参考指标。
                专家独立评分是评审制度的基本要求，采纳率高低本身不构成好坏判定——偏离 AI 既可能是专业判断的差异，也可能是 AI 建议失准。请结合具体评审场景综合研判。
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'violations' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">违规记录 · {tabLoading ? '—' : `${violations.length} 条`}</span>
            <button onClick={() => setShowViolationForm(true)} className="neu-btn-xs is-warning"><Ban size={12} />记录违规</button>
          </div>
          {showViolationForm && (
            <div className="neu-table-card p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">违规类型</span><input value={vioType} onChange={e => setVioType(e.target.value)} placeholder="如 迟到、泄密、受贿" className="workbench-input" /></label>
                <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">严重程度</span><select value={vioSeverity} onChange={e => setVioSeverity(e.target.value as any)} className="workbench-input"><option value="warning">警告</option><option value="danger">严重</option></select></label>
              </div>
              <label className="space-y-1 block"><span className="text-xs font-semibold text-[var(--muted-foreground)]">详情</span><textarea value={vioDetail} onChange={e => setVioDetail(e.target.value)} placeholder="详细描述违规事项..." className="neu-input text-sm w-full" rows={2} /></label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowViolationForm(false)} className="neu-btn-xs">取消</button>
                <button onClick={submitViolation} disabled={vioSaving} className="neu-btn-xs is-danger">{vioSaving ? '...' : '确认记录'}</button>
              </div>
            </div>
          )}
          {tabLoading ? (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载中...</div>
          ) : tabError.violations ? (
            <div className="neu-table-card py-14 text-center">
              <p className="text-sm font-semibold text-[var(--danger)] mb-3">加载失败，点击重试</p>
              <button onClick={() => retryTab('violations')} className="neu-btn-xs is-info"><RefreshCw size={12} />重试</button>
            </div>
          ) : violations.length === 0 ? (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">暂无违规记录</div>
          ) : (
            violations.map((v: any) => {
              const d = v.details || {};
              return (
                <div key={v.id} className="neu-table-card p-3 flex items-start gap-3">
                  <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${d.severity === 'danger' ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[var(--foreground)]">{d.type}</span>
                      <StatusBadge tone={d.severity === 'danger' ? 'red' : 'orange'}>{d.severity === 'danger' ? '严重' : '警告'}</StatusBadge>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{d.detail}</p>
                    <p className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">
                      {new Date(v.createdAt).toLocaleString('zh-CN')} · {v.user?.displayName || '系统'}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'notify' && (
        <div className="neu-table-card p-5 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="neu-icon-well flex h-8 w-8 items-center justify-center rounded-[10px]"><Bell size={14} className="text-[var(--accent)]" /></div>
            <span className="text-sm font-bold text-[var(--foreground)]">通知偏好设置</span>
          </div>
          <div className="space-y-3">
            {[
              { key: 'inApp' as const, icon: Bell, label: 'OA站内信', desc: '通过站内信接收评审任务通知' },
              { key: 'sms' as const, icon: MessageSquare, label: '短信通知', desc: '通过短信接收评审任务通知' },
              { key: 'phone' as const, icon: Phone, label: '电话通知', desc: '通过语音电话接收紧急通知' },
            ].map(ch => (
              <div key={ch.key} className="flex items-center justify-between rounded-xl bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                <div className="flex items-center gap-3">
                  <ch.icon size={18} className="text-[var(--muted-foreground)]" />
                  <div>
                    <div className="text-sm font-semibold text-[var(--foreground)]">{ch.label}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)]">{ch.desc}</div>
                  </div>
                </div>
                <button
                  onClick={() => setNotifyPrefs(prev => ({ ...prev, [ch.key]: !prev[ch.key] }))}
                  className="neu-toggle"
                  data-on={notifyPrefs[ch.key]}
                  aria-pressed={notifyPrefs[ch.key]}
                  aria-label={`${ch.label}通知`}
                >
                  <span className="neu-toggle__knob" />
                </button>
              </div>
            ))}
          </div>
          <button onClick={saveNotifyPrefs} className="neu-btn-soft w-full justify-center">保存偏好设置</button>

          {/* 通知发送历史 */}
          <hr className="wb-section-rule" />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <History size={13} className="text-[var(--muted-foreground)]" />
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">最近通知记录</span>
            </div>
            {notifyHistory.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">该专家暂无通知发送记录</p>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {notifyHistory.map((item, i) => {
                  const chLabel = item.channel === 'in_app' ? '站内信' : item.channel === 'sms' ? '短信' : item.channel === 'phone' ? '电话' : item.channel;
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-[color-mix(in_oklch,var(--surface)_60%,transparent)] px-3 py-1.5 text-xs">
                      <span className="font-semibold text-[var(--foreground)] capitalize">{chLabel}</span>
                      <StatusBadge tone={item.status === 'sent' ? 'green' : item.status === 'failed' ? 'red' : 'orange'}>{item.status === 'sent' ? '已送达' : item.status === 'failed' ? '失败' : item.status}</StatusBadge>
                      <span className="tabular-nums text-[var(--muted-foreground)] ml-auto">{new Date(item.time).toLocaleDateString('zh-CN')} {new Date(item.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}


      {/* 邀请代回应/代变更弹窗（2026-10-21 留痕通道：必填理由） */}
      {inviteProxy && (
        <Modal
          open
          onClose={() => { if (!inviteProxyBusy) setInviteProxy(null); }}
          closeOnBackdrop={!inviteProxyBusy}
          closeOnEsc={!inviteProxyBusy}
          size="md"
          title={inviteProxy.current === 'pending' ? '工作人员代回应专家邀请' : '工作人员代为变更专家邀请'}
          description={`${expert?.displayName ?? ''} · ${inviteProxy.projectName} · 当前${
            inviteProxy.current === 'pending' ? '待回复' : inviteProxy.current === 'confirmed' ? '确认参加' : '已婉拒'
          }`}
          footer={
            <>
              <button onClick={() => setInviteProxy(null)} disabled={inviteProxyBusy} className="neu-btn-soft !h-9 !text-[13px] disabled:opacity-40">取消</button>
              <button onClick={() => void submitInviteProxy()} disabled={inviteProxyBusy} className="neu-btn-primary !h-9 !text-[13px] disabled:opacity-50">
                {inviteProxyBusy && <Loader2 size={14} className="animate-spin" />}
                {inviteProxy.target === 'confirmed' ? '确认代为确认参加' : '确认代为婉拒'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-[12px] px-4 py-3"
              style={{ background: 'oklch(1 0 0 / 0.45)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
              <span className="text-[12px] font-semibold"
                style={{ color: inviteProxy.current === 'confirmed' ? 'var(--success)' : inviteProxy.current === 'declined' ? 'var(--danger)' : 'var(--muted-foreground)' }}>
                {inviteProxy.current === 'pending' ? '待回复' : inviteProxy.current === 'confirmed' ? '确认参加' : '已婉拒'}
              </span>
              <span className="text-[var(--muted-foreground)]">→</span>
              <span className="text-[12px] font-bold" style={{ color: inviteProxy.target === 'confirmed' ? 'var(--success)' : 'var(--danger)' }}>
                {inviteProxy.target === 'confirmed' ? '确认参加' : '婉拒'}
              </span>
            </div>
            {inviteProxy.current === 'confirmed' && inviteProxy.target === 'declined' && (
              <div className="rounded-[12px] px-4 py-3 text-[11px] leading-5"
                style={{ background: 'color-mix(in oklch, var(--warning) 9%, transparent)', color: 'var(--foreground)' }}>
                确认→婉拒将<b>站内信通知专家本人</b>（含理由与操作人）并计入邀请轨迹；若为正选将自动递补候补。
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-[var(--foreground)] mb-1.5 block">
                代回应理由 <span className="text-[var(--danger)]">*</span>
                <span className="ml-1.5 font-normal text-[var(--muted-foreground)]">（必填，至少 5 个字；留痕展示）</span>
              </label>
              <textarea
                value={inviteProxyReason}
                onChange={(ev) => setInviteProxyReason(ev.target.value)}
                rows={3}
                maxLength={500}
                disabled={inviteProxyBusy}
                placeholder="如：电话核实专家档期，对方口头确认参加评审…"
                className="neu-input w-full resize-none text-[13px]"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* 编辑资料弹窗（Modal 表单范式） */}
      {showEditModal && (
        <Modal
          open
          onClose={() => setShowEditModal(false)}
          closeOnBackdrop={!editSaving}
          closeOnEsc={!editSaving}
          title={
            <span className="flex items-center gap-2">
              <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]"><Pencil size={14} strokeWidth={1.9} className="text-[var(--accent)]" /></span>
              编辑专家资料
            </span>
          }
          description={<span>基础信息用于评审抽取匹配与通知触达</span>}
          size="lg"
          footer={
            <>
              <button type="button" onClick={() => setShowEditModal(false)} disabled={editSaving} className="neu-btn-soft !h-9 !text-xs">取消</button>
              <button type="button" onClick={saveProfile} disabled={editSaving} className="neu-btn-soft is-info !h-9 !text-xs">{editSaving ? '保存中…' : '保存'}</button>
            </>
          }
        >
          {/* 分区表单：身份联系 / 专业资格 / 所属状态 / 档案备注（信息密度用排版层级分而非堆间隔） */}
          <div className="space-y-5">
            <section className="space-y-3">
              <GroupHead>身份与联系 · 通知触达</GroupHead>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {PROFILE_FIELDS.filter(f => ['displayName', 'idNumber', 'phone', 'email', 'ethnicity', 'education'].includes(f.key)).map(f => (
                  <label key={f.key} className="space-y-1 block">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">{f.label}</span>
                    <input value={editForm[f.key]} onChange={e => setEditForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="workbench-input" />
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <GroupHead>专业资格 · 抽取匹配</GroupHead>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {PROFILE_FIELDS.filter(f => ['specialty', 'title', 'licenseNo'].includes(f.key)).map(f => (
                  <label key={f.key} className="space-y-1 block">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">{f.label}</span>
                    <input value={editForm[f.key]} onChange={e => setEditForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="workbench-input" />
                  </label>
                ))}
                <label className="space-y-1 block">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">库内等级<span className="ml-1 text-[10px] font-normal opacity-70">清空保存即清除</span></span>
                  <select value={editForm.expertLevel} onChange={e => setEditForm(prev => ({ ...prev, expertLevel: e.target.value }))} className="workbench-input" title="专家库档案等级（区别于履职评价等级），抽取配额可按此过滤">
                    <option value="">未设置</option>
                    {(['A', 'B', 'C', 'D', 'E'] as const).map(l => <option key={l} value={l}>{l} 级</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <GroupHead>所属与状态</GroupHead>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 block sm:col-span-2">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">工作单位</span>
                  <input value={editForm.employer} onChange={e => setEditForm(prev => ({ ...prev, employer: e.target.value }))} placeholder="所在单位全称" className="workbench-input" />
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">所属部门</span>
                  <input value={editForm.departmentName} onChange={e => setEditForm(prev => ({ ...prev, departmentName: e.target.value }))} placeholder="如 工程勘察院" className="workbench-input" />
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">可用状态</span>
                  <select value={editForm.availability} onChange={e => setEditForm(prev => ({ ...prev, availability: e.target.value as '可用' | '占用' | '停用' }))} className="workbench-input">
                    <option value="可用">可用</option>
                    <option value="占用">占用</option>
                    <option value="停用">停用</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="space-y-3">
              <GroupHead>档案维度与备注</GroupHead>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 block">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">区域代码<span className="ml-1 text-[10px] font-normal opacity-70">清空保存即清除</span></span>
                  <input value={editForm.regionCode} onChange={e => setEditForm(prev => ({ ...prev, regionCode: e.target.value }))} maxLength={6} placeholder="六位行政区划代码如 510000" className="workbench-input font-mono" />
                </label>
                <label className="space-y-1 block sm:col-span-2">
                  <span className="text-xs font-semibold text-[var(--muted-foreground)]">备注</span>
                  <textarea value={editForm.notes} onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="履职备注、回避事项等（可选）" className="neu-input text-sm w-full" rows={3} />
                </label>
              </div>
            </section>
          </div>

        </Modal>
      )}
    </div>
  );
}

/** 弹窗内分区标题：小号大写字距 + 右延 hairline（与公司分组标题同语言） */
function GroupHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">{children}</span>
      <span className="h-px min-w-4 flex-1 bg-[color-mix(in_oklch,var(--muted-foreground)_14%,transparent)]" />
    </div>
  );
}
