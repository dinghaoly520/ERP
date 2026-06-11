'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Clock, CheckCircle, TrendingUp, Clipboard, ScrollText, Inbox, Megaphone, Building2, Edit3, MessageSquare, Pencil, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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
    }).catch(() => {}).finally(() => setLoading(false));
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

  if (loading) return <div className="text-[oklch(0.55_0.01_264)] py-20 text-center">加载中...</div>;
  if (!profile) return <div className="text-[#e74c3c] py-20 text-center">未找到专家信息</div>;

  const totalProjects = profile.assignments.length;
  const completedProjects = profile.assignments.filter(a => a.progress >= 100).length;
  const totalScoreRecords = profile.assignments.reduce((s, a) => s + a.scoreRecords.length, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)] mb-1">个人信息</h1>
      <p className="text-sm text-[oklch(0.55_0.01_264)] mb-6">管理您的专家资料、查看评审统计数据</p>

      <div className="grid grid-cols-[1fr_380px] gap-6">
        <div className="space-y-6">
          {/* 资料卡片 */}
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] overflow-hidden">
            <div className="bg-gradient-to-r from-[#5b21b6] to-[#a78bfa] p-6 text-white">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold">
                  {profile.displayName?.[0] || '?'}
                </div>
                <div>
                  <h2 className="text-xl font-bold">{profile.displayName}</h2>
                  <p className="text-white/80 text-sm mt-0.5">评审专家 · {profile.username}</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {editing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">姓名</label>
                    <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                      className="w-full border border-[oklch(0.91_0.006_264)] rounded-lg px-4 py-2.5 text-sm focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed] outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1.5">邮箱</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full border border-[oklch(0.91_0.006_264)] rounded-lg px-4 py-2.5 text-sm focus:border-[#7c3aed] focus:ring-1 focus:ring-[#7c3aed] outline-none" />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSave} disabled={saving}
                      className="px-5 py-2 bg-[#7c3aed] text-white rounded-lg text-sm font-semibold hover:bg-[#6d28d9] transition disabled:opacity-50">
                      {saving ? '保存中...' : '保存'}
                    </button>
                    <button onClick={() => { setEditing(false); setForm({ displayName: profile.displayName, email: profile.email || '' }); }}
                      className="px-5 py-2 bg-[oklch(0.94_0.004_264)] text-[oklch(0.55_0.01_264)] rounded-lg text-sm font-semibold hover:bg-[#e8eef4] transition">取消</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                    {[
                      ['用户名', profile.username], ['姓名', profile.displayName],
                      ['邮箱', profile.email || '未设置'], ['角色', '评审专家'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">{label}</p>
                        <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{value}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditing(true)}
                    className="px-4 py-2 bg-purple-50 text-[#7c3aed] text-sm font-semibold rounded-lg border border-purple-100 hover:bg-purple-100 transition">
                    ✏️ 编辑资料
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 统计卡片 */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '参与项目', value: totalProjects, color: '#7c3aed' },
              { label: '已完成', value: completedProjects, color: '#11a874' },
              { label: '评分记录', value: totalScoreRecords, color: '#f5a623' },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 text-center hover:shadow-md transition-shadow">
                <div className="text-2xl mb-2">{card.label === '参与项目' ? '📊' : card.label === '已完成' ? '✅' : '📝'}</div>
                <div className="text-3xl font-bold" style={{ color: card.color }}>{card.value}</div>
                <div className="text-sm text-[oklch(0.55_0.01_264)] mt-1">{card.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧 - 评审记录 */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[oklch(0.18_0.012_265)]">📜 评审记录</h3>
              <button onClick={() => router.push('/projects')} className="text-xs text-[#7c3aed] hover:underline font-semibold">查看全部</button>
            </div>
            {profile.assignments.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-sm text-[oklch(0.55_0.01_264)]">暂无评审记录</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {profile.assignments.map(a => (
                  <div key={a.id}
                    className="p-4 bg-purple-50 rounded-lg border border-purple-100 hover:border-[#c4b5fd] transition cursor-pointer"
                    onClick={() => router.push(`/evaluate/${a.project.id}`)}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-[oklch(0.18_0.012_265)] truncate flex-1 mr-2">{a.project.name}</h4>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded flex-shrink-0 ${a.progress >= 100 ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-[#7c3aed]'}`}>
                        {a.progress >= 100 ? '已完成' : stageLabel[a.project.stage] || a.project.stage}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[oklch(0.55_0.01_264)] mb-2">
                      <span>{a.project.projectCode}</span>
                      <span>评分 {a.scoreRecords.length} 项</span>
                    </div>
                    <div className="h-1.5 bg-[oklch(0.94_0.004_264)] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${a.progress >= 100 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-[#7c3aed] to-[#a78bfa]'}`}
                        style={{ width: `${a.progress}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 评审须知 */}
          <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl border border-purple-100 p-5">
            <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3">📋 评审须知</h3>
            <ul className="space-y-2 text-sm text-[oklch(0.55_0.01_264)]">
              <li className="flex items-start gap-2"><span className="text-[#7c3aed] mt-0.5">•</span>评审前需完成身份核验与回避确认</li>
              <li className="flex items-start gap-2"><span className="text-[#7c3aed] mt-0.5">•</span>独立评审，不得与其他专家商议</li>
              <li className="flex items-start gap-2"><span className="text-[#7c3aed] mt-0.5">•</span>所有评分需给出客观理由</li>
              <li className="flex items-start gap-2"><span className="text-[#7c3aed] mt-0.5">•</span>评审全程留痕，受监督审计</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
