'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, ClipboardList, ScrollText, ChevronRight, UserCircle } from 'lucide-react';
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
  // 2026-11-06 扩面（用户裁定：除工作单位外全字段可改）——姓名/邮箱/手机/专业/职称/身份证号
  const [form, setForm] = useState({ displayName: '', email: '', phone: '', specialty: '', title: '', idNumber: '' });
  const [saving, setSaving] = useState(false);

  const fillForm = (data: ExpertProfile) => setForm({
    displayName: data.displayName,
    email: data.email || '',
    phone: data.expertProfile?.phone || '',
    specialty: data.expertProfile?.specialty || '',
    title: data.expertProfile?.title || '',
    idNumber: data.expertProfile?.idNumber || '',
  });

  useEffect(() => {
    api.get<ExpertProfile>('/expert/profile').then(data => {
      setProfile(data);
      fillForm(data);
    }).catch(() => toast.error('操作失败')).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/expert/profile', form);
      toast.success('资料已更新，采购管理端专家信息已同步');
      // Refresh profile from server, then exit editing mode
      const data = await api.get<ExpertProfile>('/expert/profile');
      setProfile(data);
      fillForm(data);
      setEditing(false);
    } catch (e: any) { toast.error(e.message || '更新失败'); } // P2-2：透出服务端校验消息（如「姓名不能为空」）
    setSaving(false);
  };

  // P2-2（2026-09-21 审查）：空名/坏邮箱前端先拦——服务端静默跳过空名的假成功由此杜绝双保险
  const emailValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const phoneValid = !form.phone || /^1\d{10}$/.test(form.phone);
  const idNumberValid = !form.idNumber || /^\d{17}[\dX]$/.test(form.idNumber);
  const canSave = form.displayName.trim().length > 0 && emailValid && phoneValid && idNumberValid;

  const cancelEdit = () => {
    setEditing(false);
    if (profile) fillForm(profile);
  };

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;
  if (!profile) return <div className="py-20 text-center text-sm text-[var(--danger)]">未找到专家信息</div>;

  // KPI 四瓷片已删（2026-11-06 用户裁定）——派生量收编进标题副标题行（:3005 口径：
  // 纯统计入副标题、零值不噪音；均分无值整段省略）
  const totalProjects = profile.assignments.length;
  const inProgress = profile.assignments.filter(a => a.progress < 100).length;
  const totalScoreRecords = profile.assignments.reduce((s, a) => s + a.scoreRecords.length, 0);

  /** EXP-P2-04：身份证号脱敏（前4后3；短串整段打码）——专家口令=身份证号，明文即展示登录密码。
   *  2026-11-06：username 本身即身份证号（专家口令），所有展示位（用户名行/副标题）一律同款脱敏 */
  const maskIdNumber = (id?: string | null): string => {
    if (!id) return '';
    if (id.length < 8) return '*'.repeat(id.length);
    return `${id.slice(0, 4)}${'*'.repeat(id.length - 7)}${id.slice(-3)}`;
  };
  /** 手机号脱敏（3****4；短串整段打码）——2026-11-06 用户裁定：本页手机号不再明文 */
  const maskPhone = (p?: string | null): string => {
    if (!p) return '';
    if (p.length < 7) return '*'.repeat(p.length);
    return `${p.slice(0, 3)}****${p.slice(-4)}`;
  };

  // 用户名行已删（2026-11-06 用户裁定「现在不存在用户名」——专家以姓名+身份证号口令登录，
  // 该行与身份证号重复且泄露口令前缀）；工作单位只读（用户裁定），其余字段可编辑
  const readonlyView: [string, string][] = [
    ['工作单位', profile.expertProfile?.employer || '未设置'],
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
              <div className="page-hero__sub">基本资料维护与评审记录总览</div>
            </div>
          </div>
          <div className="page-hero__right">
            {/* 统计胶囊（2026-11-06 用户裁定，二修）：零值不显示——有真实数据才亮出，
                与 :3005「待审核 0 / 累计评价 0 次」删除裁定同口径 */}
            {totalProjects > 0 && (
              <span className="page-hero__stat page-hero__stat--info" title="累计分配评审项目 / 进行中">
                参与 {totalProjects} · 进行中 {inProgress}
              </span>
            )}
            {totalScoreRecords > 0 && (
              <span className="page-hero__stat page-hero__stat--info" title="累计提交评分项">评分 {totalScoreRecords} 条</span>
            )}
            {profile.averageScore != null && totalScoreRecords > 0 && (
              <span className="page-hero__stat page-hero__stat--info" title="历史评分均值">平均给分 {profile.averageScore}</span>
            )}
            {/* 编辑态的 取消/保存 已删（2026-11-06 用户裁定）——操作钮只在表单底部，
                标题栏仅保留非编辑态的「编辑资料」入口 */}
            {!editing && (
              <button onClick={() => setEditing(true)} className="neu-btn-soft">
                <Pencil size={14} strokeWidth={1.6} />
                编辑资料
              </button>
            )}
          </div>
        </div>

        <div className="wb-section-rule" />
        {/* KPI 四瓷片已删（2026-11-06 用户裁定：参与项目/已完成/评分记录/平均给分）——
            评审明细在下方「评审记录」与工作台呈现，此页专注资料维护 */}
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
            </div>
          </div>

          <hr className="wb-section-rule mb-5" />

          {/* 字段网格（2026-11-06 用户裁定：除工作单位外全字段可编辑；编辑态全网格同构，
              可改字段原位变输入框；手机/身份证号查看态脱敏） */}
          <div className="grid grid-cols-2 gap-x-12 gap-y-4">
            {([
              { key: 'displayName', label: '姓名', mono: false, display: profile.displayName, invalid: form.displayName.trim().length === 0, invalidMsg: '姓名不能为空' },
              { key: 'email', label: '邮箱', mono: false, display: profile.email || '未设置', invalid: !!form.email && !emailValid, invalidMsg: '邮箱格式不正确' },
              { key: 'phone', label: '手机', mono: true, display: maskPhone(profile.expertProfile?.phone || profile.phone) || '未设置', placeholder: '11 位手机号', invalid: !!form.phone && !phoneValid, invalidMsg: '手机号须为 11 位有效号码' },
              { key: 'specialty', label: '专业', mono: false, display: profile.expertProfile?.specialty || '未设置' },
              { key: 'title', label: '职称', mono: false, display: profile.expertProfile?.title || '未设置' },
              { key: 'idNumber', label: '身份证号', mono: true, display: maskIdNumber(profile.expertProfile?.idNumber) || '未设置', placeholder: '18 位身份证号', invalid: !!form.idNumber && !idNumberValid, invalidMsg: '身份证号须为 18 位有效号码' },
            ] as const).map(f => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold text-[var(--muted-foreground)]">{f.label}</label>
                {editing ? (
                  <>
                    <input
                      value={form[f.key as 'displayName']}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      aria-invalid={'invalid' in f && f.invalid ? 'true' : undefined}
                      className={`neu-input !h-9 text-sm ${f.mono ? 'font-mono' : ''}`}
                      placeholder={'placeholder' in f ? f.placeholder : undefined}
                    />
                    {'invalid' in f && f.invalid && (
                      <p className="mt-1 text-xs font-semibold text-[var(--danger)]">{f.invalidMsg}</p>
                    )}
                  </>
                ) : (
                  <p className={`text-sm font-bold text-[var(--foreground)] ${f.mono ? 'font-mono' : ''}`}>{f.display}</p>
                )}
              </div>
            ))}
            {readonlyView.map(([label, value]) => (
              <div key={label}>
                <p className="mb-1 text-xs font-semibold text-[var(--muted-foreground)]">{label}</p>
                <p className="text-sm font-bold text-[var(--foreground)]">{value}</p>
              </div>
            ))}
          </div>
          {editing && (
            <div className="mt-5 flex gap-3">
              <button onClick={handleSave} disabled={saving || !canSave} className="neu-btn-primary !h-[38px]">
                {saving ? '保存中...' : '保存'}
              </button>
              <button onClick={cancelEdit} className="neu-btn-soft !h-[38px]">取消</button>
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
