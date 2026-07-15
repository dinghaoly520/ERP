'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { getExpertPortrait, getExpertEvaluations, getViolations, addViolation, getNotifyPrefs, updateNotifyPrefs, getAiAdoptionRate, type ExpertPortrait } from '@/lib/api/expert';
import { AlertBanner, Breadcrumb, StatusBadge } from '@/components/workbench';
import { useExpertAlerts } from '@/lib/hooks/use-alerts';
import { ArrowLeft, TrendingUp, Award, AlertTriangle, ShieldAlert, Bell, Phone, MessageSquare, History, Ban, Sparkles, RefreshCw } from 'lucide-react';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

interface ScoreRecord { id: string; score: number; reason: string | null; scoreItem: { name: string; category: string; maxScore: number }; }
interface Assignment {
  id: string; expertName: string; major: string; progress: number;
  signedIn: boolean; avoidanceConfirmed: boolean; totalScore: number;
  project: { id: string; projectCode: string; name: string; stage: string; procurementMethod: string; openTime: string };
  scoreRecords: ScoreRecord[];
}
interface ExpertDetail {
  id: string; username: string; displayName: string; email: string | null;
  department: { id: string; name: string } | null; createdAt: string; isActive: boolean;
  expertProfile?: { specialty?: string; title?: string; employer?: string; phone?: string; availability?: string; notes?: string; education?: string; ethnicity?: string; licenseNo?: string };
  assignments: Assignment[];
  statistics: { totalProjects: number; completedProjects: number; signedInProjects: number; evalAvg: number; evalCount: number };
}

const STAGE_FALLBACK_COLOR = 'var(--muted-foreground)';
const levelLabel: Record<string, string> = { A: '优秀', B: '良好', C: '合格', D: '不合格' };
const levelTone: Record<string, 'green' | 'blue' | 'orange' | 'red'> = { A: 'green', B: 'blue', C: 'orange', D: 'red' };

type Tab = 'overview' | 'timeline' | 'portrait' | 'evaluations' | 'ai-adoption' | 'violations' | 'notify';
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'overview', label: '评审项目', icon: TrendingUp },
  { key: 'timeline', label: '大事记', icon: Award },
  { key: 'portrait', label: '专家画像', icon: TrendingUp },
  { key: 'evaluations', label: '评价历史', icon: History },
  { key: 'ai-adoption', label: 'AI采纳率', icon: Sparkles },
  { key: 'violations', label: '违规记录', icon: ShieldAlert },
  { key: 'notify', label: '通知偏好', icon: Bell },
];

export default function ExpertDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expertId = params.id as string;
  const [expert, setExpert] = useState<ExpertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [tabLoading, setTabLoading] = useState(false);
  const loadedTabsRef = useRef<Set<Tab>>(new Set(['overview']));

  // Sub-data
  const [portrait, setPortrait] = useState<ExpertPortrait | null>(null);
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [violations, setViolations] = useState<any[]>([]);
  const [notifyPrefs, setNotifyPrefs] = useState({ inApp: true, sms: false, phone: false });
  // AI 采纳率
  const [aiAdoption, setAiAdoption] = useState<any>(null);
  // Violation form
  const [showViolationForm, setShowViolationForm] = useState(false);
  const [vioType, setVioType] = useState('');
  const [vioDetail, setVioDetail] = useState('');
  const [vioSeverity, setVioSeverity] = useState<'warning' | 'danger'>('warning');
  const [vioSaving, setVioSaving] = useState(false);

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
    ...(expertAlerts.consecutiveD ? [{ severity: 'red' as const, title: '连续 2 次 D 级评价', detail: '该专家近期履职评价连续不合格，建议关注' }] : []),
    ...(expertAlerts.overloaded ? [{ severity: 'orange' as const, title: '评审负荷过载', detail: `同时参与 ${expertAlerts.activeProjectCount} 个未归档项目，超过 3 个上限` }] : []),
  ];

  // Load tab data（首次进入某 Tab 显示加载态；已缓存则直接复用，避免闪烁）
  useEffect(() => {
    if (loadedTabsRef.current.has(tab)) { setTabLoading(false); return; }
    setTabLoading(true);
    const tasks: Promise<unknown>[] = [];
    if (tab === 'portrait') tasks.push(getExpertPortrait(expertId).then(setPortrait));
    if (tab === 'evaluations') tasks.push(getExpertEvaluations(expertId).then(setEvaluations));
    if (tab === 'timeline') { tasks.push(getExpertEvaluations(expertId).then(setEvaluations)); tasks.push(getViolations(expertId).then(setViolations)); }
    if (tab === 'violations') tasks.push(getViolations(expertId).then(setViolations));
    if (tab === 'ai-adoption') tasks.push(getAiAdoptionRate(expertId).then(setAiAdoption));
    if (tab === 'notify') tasks.push(getNotifyPrefs(expertId).then(setNotifyPrefs));
    Promise.all(tasks.map(p => p.catch(() => {})))
      .finally(() => { setTabLoading(false); loadedTabsRef.current = new Set(loadedTabsRef.current).add(tab); });
  }, [tab, expertId]);

  // 切换专家时重置 Tab 缓存
  useEffect(() => { loadedTabsRef.current = new Set(['overview']); }, [expertId]);

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

  return (
    <div>
      <Breadcrumb items={[{ label: '专家库', path: '/expert/repository' }, { label: expert?.displayName || '详情' }]} />
      {alertItems.length > 0 && <div className="mb-5"><AlertBanner items={alertItems} /></div>}

      {/* Header */}
      <div className="page-hero mb-5">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Award size={17} /></div>
            <div>
              <div className="page-hero__title">{expert.displayName}</div>
              <div className="page-hero__sub">
                {expert.expertProfile?.specialty && <span>{expert.expertProfile.specialty}</span>}
                {expert.expertProfile?.title && <span className="ml-2">· {expert.expertProfile.title}</span>}
                {expert.expertProfile?.employer && <span className="ml-2">· {expert.expertProfile.employer}</span>}
                {expert.expertProfile?.education && <span className="ml-2">· {expert.expertProfile.education}</span>}
                {expert.expertProfile?.licenseNo && <span className="ml-2">· 执业资格: {expert.expertProfile.licenseNo}</span>}
              </div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft gap-1"><ArrowLeft size={14} />返回专家库</button>
            <StatusBadge tone={expert.isActive ? 'green' : 'gray'}>{expert.isActive ? '可用' : '已停用'}</StatusBadge>
            {portrait?.isStandingExpert && <StatusBadge tone="purple">常委专家</StatusBadge>}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 mb-5">
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

      {/* Tab bar */}
      <div className="neu-tab-bar mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => {
              // 同步设 tabLoading，消除“先空后加载”的闪烁
              if (!loadedTabsRef.current.has(t.key)) setTabLoading(true);
              setTab(t.key);
            }}
            className={`neu-tab ${tab === t.key ? 'is-active' : ''}`}
          >
            <t.icon size={14} /><span className="ml-1.5">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
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
            title: `${levelLabel[ev.level] || ev.level}级 · 综合${ev.overallScore}分`,
            detail: `出勤${ev.attendanceScore}/质量${ev.qualityScore}/廉洁${ev.disciplineScore} · 评价人:${ev.evaluator?.displayName || '—'}${ev.comment ? ' · ' + ev.comment : ''}`,
            tone: ev.level === 'A' ? 'green' : ev.level === 'B' ? 'accent' : ev.level === 'D' ? 'red' : 'orange',
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
              ['平均得分', portrait.averageScore != null ? `${portrait.averageScore} 分` : '—'],
              ['常委资格', portrait.isStandingExpert ? '是' : '否'],
              ['评分偏离度', portrait.meanDeviation != null ? `${portrait.meanDeviation > 0 ? '+' : ''}${portrait.meanDeviation}` : '—'],
              ['偏离样本', `${portrait.deviationSamples} 条`],
              ['评价均分', portrait.evalAvg != null ? `${portrait.evalAvg} 分` : '—'],
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
                  <StatusBadge key={i} tone={levelTone[lv] || 'gray'}>{levelLabel[lv] || lv}</StatusBadge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {tab === 'portrait' && !portrait && (
        <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">加载画像数据中...</div>
      )}

      {tab === 'evaluations' && (
        <div className="neu-table-card">
          {tabLoading ? (
            <div className="py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载中...</div>
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
                      <td className="text-center text-xs font-bold tabular-nums">{ev.attendanceScore}</td>
                      <td className="text-center text-xs font-bold tabular-nums">{ev.qualityScore}</td>
                      <td className="text-center text-xs font-bold tabular-nums">{ev.disciplineScore}</td>
                      <td className="text-center text-xs font-bold tabular-nums text-[var(--accent)]">{ev.overallScore}</td>
                      <td className="text-center"><StatusBadge tone={levelTone[ev.level] || 'gray'}>{levelLabel[ev.level]}</StatusBadge></td>
                      <td className="text-xs text-[var(--muted-foreground)]">{ev.evaluator?.displayName || '—'}</td>
                      <td className="text-xs text-[var(--muted-foreground)] max-w-[160px] truncate">{ev.comment || '—'}</td>
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['评分记录', aiAdoption?.overall?.total ?? 0, '参与评分项数'],
              ['AI采纳', aiAdoption?.overall?.accepted ?? 0, '与AI建议一致'],
              ['采纳率', `${aiAdoption?.overall?.adoptionRate ?? 0}%`, '越高说明评分越客观'],
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
                AI 采纳率反映专家评分与 AI 建议分的一致性。每项评分若与 AI 建议偏差在 ±10% 以内则视为"采纳"。
                采纳率越高说明专家评分越接近 AI 客观基准；偏离度越低说明专家主观偏差越小。
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
        </div>
      )}
    </div>
  );
}
