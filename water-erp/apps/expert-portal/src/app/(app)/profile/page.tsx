'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, ClipboardList, CheckCircle, FileText, TrendingUp, ScrollText, ChevronRight, UserCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

interface ExpertProfile {
  id: string; username: string; displayName: string; email: string; role: string; isActive: boolean;
  phone?: string;
  averageScore: number;
  expertProfile?: {
    specialty?: string; title?: string; employer?: string; phone?: string;
    idNumber?: string; ethnicity?: string; education?: string; licenseNo?: string;
    contactConfirmedAt?: string | null;
  } | null;
  assignments: {
    id: string; expertName: string; major: string; signedIn: boolean; avoidanceConfirmed: boolean; progress: number; totalScore: number; createdAt: string;
    project: { id: string; projectCode: string; name: string; stage: string; openTime: string };
    scoreRecords: { id: string; score: number; reason?: string; scoreItem: { category: string; name: string; maxScore: number } }[];
  }[];
}

export default function ExpertProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ExpertProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<ExpertProfile>('/expert/profile').then(data => {
      setProfile(data);
      setForm({ displayName: data.displayName, email: data.email || '' });
    }).catch(() => toast.error('操作失败')).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/expert/profile', form);
      toast.success('资料已更新');
      // Refresh profile from server, then exit editing mode
      const data = await api.get<ExpertProfile>('/expert/profile');
      setProfile(data);
      setForm({ displayName: data.displayName, email: data.email || '' });
      setEditing(false);
    } catch { toast.error('更新失败'); }
    setSaving(false);
  };

  const cancelEdit = () => {
    setEditing(false);
    if (profile) setForm({ displayName: profile.displayName, email: profile.email || '' });
  };

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;
  if (!profile) return <div className="py-20 text-center text-sm text-[var(--danger)]">未找到专家信息</div>;

  const totalProjects = profile.assignments.length;
  const completedProjects = profile.assignments.filter(a => a.progress >= 100).length;
  const totalScoreRecords = profile.assignments.reduce((s, a) => s + a.scoreRecords.length, 0);

  const kpis = [
    { label: '参与项目', value: totalProjects, sub: '累计分配评审项目', sig: 'var(--accent-strong)', sigLabel: '进行中', Icon: ClipboardList },
    { label: '已完成', value: completedProjects, sub: '评审完成并归档', sig: 'var(--success)', sigLabel: '已完成', Icon: CheckCircle },
    { label: '评分记录', value: totalScoreRecords, sub: '累计提交评分项', sig: 'var(--warning)', sigLabel: '累计', Icon: FileText },
    { label: '平均给分', value: profile.averageScore ?? 0, sub: '历史评分均值', sig: 'var(--accent)', sigLabel: '均值', Icon: TrendingUp },
  ];

  const infoFields: [string, string][] = [
    ['姓名', profile.displayName],
    ['用户名', profile.username],
    ['手机', profile.expertProfile?.phone || profile.phone || '未设置'],
    ['邮箱', profile.email || '未设置'],
    ['专业', profile.expertProfile?.specialty || '未设置'],
    ['职称', profile.expertProfile?.title || '未设置'],
    ['工作单位', profile.expertProfile?.employer || '未设置'],
    ['身份证号', profile.expertProfile?.idNumber || '未设置'],
    ['角色', '评审专家'],
  ];

  return (
    <div className="space-y-5">
      {/* 页面标题卡片 + KPI 指标瓷片 */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UserCircle size={18} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">个人信息</div>
              <div className="page-hero__sub">评审专家 · {profile.username} — 基本资料维护与评审记录总览</div>
            </div>
          </div>
          <div className="page-hero__right">
            {editing ? (
              <>
                <button onClick={cancelEdit} className="neu-btn-soft">取消</button>
                <button onClick={handleSave} disabled={saving} className="neu-btn-primary">
                  {saving ? '保存中...' : '保存'}
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="neu-btn-soft">
                <Pencil size={14} strokeWidth={1.6} />
                编辑资料
              </button>
            )}
          </div>
        </div>

        <div className="wb-section-rule" />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map(k => (
            <div key={k.label} className="kpi-card flex flex-col gap-1.5 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                  <k.Icon size={13} strokeWidth={1.7} />
                  {k.label}
                </span>
                <span className="kpi-signal text-[9px] font-bold" style={{ '--s': k.sig } as React.CSSProperties}>
                  <span className="kpi-signal-dot" />
                  {k.sigLabel}
                </span>
              </div>
              <span className="text-[1.7rem] font-black leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]">{k.value}</span>
              <span className="text-[10px] font-medium text-[var(--muted-foreground)]">{k.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* 资料卡片 */}
        <div className="neu-card-static p-6">
          <div className="mb-5 flex items-center gap-4">
            <span className="exp-user-chip-avatar !h-16 !w-16 !rounded-2xl !text-2xl">
              {profile.displayName?.[0] || '?'}
            </span>
            <div>
              <h2 className="text-xl font-black tracking-tight text-[var(--foreground)]">{profile.displayName}</h2>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">评审专家 · {profile.username}</p>
            </div>
          </div>

          <hr className="wb-section-rule mb-5" />

          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-[var(--muted-foreground)]">姓名</label>
                <input
                  value={form.displayName}
                  onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  className="neu-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-[var(--muted-foreground)]">邮箱</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="neu-input"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={handleSave} disabled={saving} className="neu-btn-primary !h-[38px]">
                  {saving ? '保存中...' : '保存'}
                </button>
                <button onClick={cancelEdit} className="neu-btn-soft h-[38px]">取消</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-12 gap-y-4">
              {infoFields.map(([label, value]) => (
                <div key={label}>
                  <p className="mb-1 text-xs font-semibold text-[var(--muted-foreground)]">{label}</p>
                  <p className="text-sm font-bold text-[var(--foreground)]">{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 评审须知 */}
        <div className="neu-card-static h-fit p-5">
          <h3 className="mb-2 flex items-center gap-2 text-[0.95rem] font-bold text-[var(--foreground)]">
            <ScrollText size={16} strokeWidth={1.6} className="text-[var(--accent-strong)]" />
            评审须知
          </h3>
          <ul className="space-y-0.5 text-sm text-[var(--muted-foreground)]">
            {[
              '评审前需完成身份核验与回避确认',
              '独立评审，不得与其他专家商议',
              '所有评分需给出客观理由',
              '评审全程留痕，受监督审计',
            ].map(t => (
              <li key={t} className="exp-list-item">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-strong)]" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 评审记录 */}
      <div className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[0.95rem] font-bold text-[var(--foreground)]">
            <ClipboardList size={16} strokeWidth={1.6} className="text-[var(--accent-strong)]" />
            评审记录
          </h2>
          <button onClick={() => router.push('/projects')} className="neu-btn-xs is-info">
            查看全部 <ChevronRight size={13} strokeWidth={1.8} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table is-dense w-full min-w-[760px]">
            <thead>
              <tr>
                <th>项目</th>
                <th>角色 / 专业</th>
                <th>阶段</th>
                <th>评分</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {profile.assignments.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="py-10 text-center">
                      <ClipboardList size={40} strokeWidth={1} className="mx-auto mb-3 text-[oklch(0.75_0.02_258)]" />
                      <p className="text-sm text-[var(--muted-foreground)]">暂无评审记录</p>
                    </div>
                  </td>
                </tr>
              ) : (
                profile.assignments.map(a => {
                  const done = a.progress >= 100;
                  const sc = done ? 'var(--success)' : STAGE_COLOR[a.project.stage] || 'var(--muted-foreground)';
                  return (
                    <tr key={a.id} className="row-clickable" onClick={() => router.push(`/evaluate/${a.project.id}`)}>
                      <td>
                        <p className="max-w-[280px] truncate font-bold text-[var(--foreground)]">{a.project.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-[var(--muted-foreground)]">{a.project.projectCode}</p>
                      </td>
                      <td className="text-sm text-[var(--muted-foreground)]">评审专家 · {a.major || '综合评审'}</td>
                      <td>
                        <span className="exp-pill" style={{ '--c': sc } as React.CSSProperties}>
                          {done ? '已完成' : STAGE_LABEL[a.project.stage] || a.project.stage}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">{a.scoreRecords.length} 项</span>
                          <div className="exp-bar w-20">
                            <i style={{ width: `${a.progress}%`, '--bar': sc } as React.CSSProperties} />
                          </div>
                          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{a.progress}%</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-sm tabular-nums text-[var(--muted-foreground)]">
                        {new Date(a.createdAt).toLocaleDateString('zh-CN')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
