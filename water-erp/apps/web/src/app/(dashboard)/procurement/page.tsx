'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface ProcurementProject {
  id: string;
  title: string;
  projectCode: string;
  procurementType: string;
  procurementMethod: string;
  status: string;
  budget: number | null;
  description: string | null;
  rejectReason: string | null;
  createdAt: string;
  department: { id: string; name: string } | null;
  creator: { id: string; displayName: string } | null;
  bidProject: { id: string; projectCode: string; name: string; stage: string } | null;
}

interface Stats {
  total: number;
  DRAFT?: number;
  PENDING_REVIEW?: number;
  APPROVED?: number;
  REJECTED?: number;
  BIDDING?: number;
  CONTRACTED?: number;
  CLOSED?: number;
}

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: '草稿', color: '#5a6d8a', bg: '#5a6d8a18' },
  PENDING_REVIEW: { label: '待审批', color: '#f5a623', bg: '#f5a62318' },
  APPROVED: { label: '已审批', color: '#0891b2', bg: '#0891b218' },
  REJECTED: { label: '已驳回', color: '#ef4444', bg: '#ef444418' },
  BIDDING: { label: '招标中', color: '#064ea2', bg: '#064ea218' },
  CONTRACTED: { label: '已签约', color: '#11a874', bg: '#11a87418' },
  CLOSED: { label: '已关闭', color: '#6b7280', bg: '#6b728018' },
};

export default function ProcurementPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProcurementProject[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const query = filter ? `?status=${filter}` : '';
    Promise.all([
      api.get<ProcurementProject[]>(`/procurement${query}`).catch(() => []),
      api.get<Stats>('/procurement/stats').catch(() => ({ total: 0 })),
    ]).then(([list, s]) => {
      setProjects(list);
      setStats(s);
    }).finally(() => setLoading(false));
  }, [filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">采购管理</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">管理采购项目全生命周期：立项、编制招标文件、审查、发布</p>
        </div>
        <button
          onClick={() => router.push('/procurement/new')}
          className="px-5 py-2.5 bg-[#064ea2] text-white rounded-lg text-sm font-semibold hover:bg-[#053f85] transition shadow-md"
        >
          + 新建采购项目
        </button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '全部项目', value: stats.total, color: '#18243a' },
          { label: '草稿', value: stats.DRAFT || 0, color: '#5a6d8a' },
          { label: '待审批', value: stats.PENDING_REVIEW || 0, color: '#f5a623' },
          { label: '招标中', value: (stats.BIDDING || 0) + (stats.CONTRACTED || 0), color: '#064ea2' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{ key: '', label: '全部' }, ...Object.entries(statusMap).map(([k, v]) => ({ key: k, label: v.label }))].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${filter === f.key ? 'bg-[#064ea2] text-white shadow-md' : 'bg-white text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)] hover:border-[oklch(0.80_0.04_258)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* 项目列表 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center text-[oklch(0.55_0.01_264)]">加载中...</div>
      ) : projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">暂无采购项目</h3>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">点击右上角按钮创建第一个采购项目</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => {
            const status = statusMap[p.status] || { label: p.status, color: '#5a6d8a', bg: '#5a6d8a18' };
            return (
              <div key={p.id} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 hover:shadow-md hover:border-[oklch(0.80_0.04_258)] transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#39a8ff] flex items-center justify-center text-white text-sm font-bold">
                      {p.title[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{p.title}</h3>
                      <p className="text-xs text-[oklch(0.55_0.01_264)]">{p.projectCode} · {p.procurementType} · {p.procurementMethod}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ color: status.color, backgroundColor: status.bg }}>
                    {status.label}
                  </span>
                </div>
                <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)]">
                  {p.budget != null && <span>预算：¥{Number(p.budget).toLocaleString()}</span>}
                  {p.department && <span>部门：{p.department.name}</span>}
                  {p.creator && <span>创建人：{p.creator.displayName}</span>}
                  <span>创建时间：{new Date(p.createdAt).toLocaleDateString('zh-CN')}</span>
                  {p.bidProject && <span className="text-[#064ea2] font-medium">关联招标：{p.bidProject.name}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
