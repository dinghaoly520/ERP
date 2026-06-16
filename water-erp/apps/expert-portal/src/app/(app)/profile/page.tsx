'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCircle, Pencil, ClipboardList, CheckCircle, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { PageHero, SectionCard, MetricCard } from '@water-erp/ui';

interface ExpertProfile {
  id: string; username: string; displayName: string; email: string; role: string; isActive: boolean;
  assignments: {
    id: string; expertName: string; major: string; signedIn: boolean; avoidanceConfirmed: boolean; progress: number; totalScore: number; createdAt: string;
    project: { id: string; projectCode: string; name: string; stage: string; openTime: string };
    scoreRecords: { id: string; score: number; reason?: string; scoreItem: { category: string; name: string; maxScore: number } }[];
  }[];
}

const stageLabel: Record<string, string> = { DOWNLOAD: '文件下载', SUBMIT: '加密投递', OPENING: '在线开标', EVALUATING: '专家评标', ARCHIVED: '资料归档' };

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
      setEditing(false);
      const data = await api.get<ExpertProfile>('/expert/profile');
      setProfile(data);
    } catch { toast.error('更新失败'); }
    setSaving(false);
  };

  if (loading) return <div className="py-20 text-center text-sm text-[#8a96aa]">加载中...</div>;
  if (!profile) return <div className="py-20 text-center text-sm text-[#e74c3c]">未找到专家信息</div>;

  const totalProjects = profile.assignments.length;
  const completedProjects = profile.assignments.filter(a => a.progress >= 100).length;
  const totalScoreRecords = profile.assignments.reduce((s, a) => s + a.scoreRecords.length, 0);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="个人信息"
        tone="purple"
        icon={<UserCircle size={14} strokeWidth={1.5} />}
        title="个人信息"
        description="管理您的专家资料、查看评审统计数据"
      />

      <div className="grid grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          {/* 资料卡片 */}
          <SectionCard className="overflow-hidden p-0">
            <div className="bg-gradient-to-r from-[#064ea2] to-[#0b63ce] p-6 text-white">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-2xl font-black">
                  {profile.displayName?.[0] || '?'}
                </div>
                <div>
                  <h2 className="text-xl font-black">{profile.displayName}</h2>
                  <p className="text-white/70 text-sm mt-0.5">评审专家 · {profile.username}</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {editing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-[#18243a] mb-1.5">姓名</label>
                    <input
                      value={form.displayName}
                      onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                      className="w-full rounded-xl border border-[#e5ecf4] px-4 py-2.5 text-sm focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#18243a] mb-1.5">邮箱</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full rounded-xl border border-[#e5ecf4] px-4 py-2.5 text-sm focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] outline-none transition"
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-xl bg-[#064ea2] px-5 py-2 text-sm font-bold text-white hover:bg-[#054280] transition disabled:opacity-50"
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setForm({ displayName: profile.displayName, email: profile.email || '' }); }}
                      className="rounded-xl border border-[#dce6f3] bg-white px-5 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                    {[
                      ['用户名', profile.username],
                      ['姓名', profile.displayName],
                      ['邮箱', profile.email || '未设置'],
                      ['角色', '评审专家'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <p className="text-xs font-semibold text-[#5a6d8a] mb-1">{label}</p>
                        <p className="text-sm font-bold text-[#18243a]">{value}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#dbeafe] transition"
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                    编辑资料
                  </button>
                </div>
              )}
            </div>
          </SectionCard>

          {/* 统计卡片 */}
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              label="参与项目"
              value={totalProjects}
              tone="purple"
              icon={<ClipboardList size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label="已完成"
              value={completedProjects}
              tone="green"
              icon={<CheckCircle size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label="评分记录"
              value={totalScoreRecords}
              tone="orange"
              icon={<FileText size={16} strokeWidth={1.5} />}
            />
          </div>
        </div>

        {/* 右侧 — 评审记录 */}
        <div className="space-y-4">
          <SectionCard
            title="评审记录"
            action={
              <button
                onClick={() => router.push('/projects')}
                className="text-xs font-bold text-[#064ea2] hover:text-[#054280] transition"
              >
                查看全部
              </button>
            }
          >
            {profile.assignments.length === 0 ? (
              <div className="py-8 text-center">
                <ClipboardList size={40} strokeWidth={1} className="text-[#cbd5e1] mx-auto mb-3" />
                <p className="text-sm text-[#8a96aa]">暂无评审记录</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {profile.assignments.map(a => (
                  <div key={a.id}
                    className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 hover:border-[#bfdbfe] transition cursor-pointer"
                    onClick={() => router.push(`/evaluate/${a.project.id}`)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-[#18243a] truncate flex-1 mr-2">{a.project.name}</h4>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold flex-shrink-0 ${
                        a.progress >= 100
                          ? 'border border-[#bbf7d0] bg-[#f0fdf4] text-[#11a874]'
                          : 'border border-[#bfdbfe] bg-white text-[#064ea2]'
                      }`}>
                        {a.progress >= 100 ? '已完成' : stageLabel[a.project.stage] || a.project.stage}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#5a6d8a] mb-2">
                      <span className="font-mono">{a.project.projectCode}</span>
                      <span>评分 {a.scoreRecords.length} 项</span>
                    </div>
                    <div className="h-1.5 bg-[#e8f0fa] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          a.progress >= 100
                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                            : 'bg-gradient-to-r from-[#064ea2] to-[#0b63ce]'
                        }`}
                        style={{ width: `${a.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* 评审须知 */}
          <SectionCard title="评审须知" className="!border-[#bfdbfe] !bg-[#eff6ff]">
            <ul className="space-y-2 text-sm text-[#5a6d8a]">
              <li className="flex items-start gap-2">
                <span className="text-[#064ea2] mt-0.5">•</span>
                评审前需完成身份核验与回避确认
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#064ea2] mt-0.5">•</span>
                独立评审，不得与其他专家商议
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#064ea2] mt-0.5">•</span>
                所有评分需给出客观理由
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#064ea2] mt-0.5">•</span>
                评审全程留痕，受监督审计
              </li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
