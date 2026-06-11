'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface BidProject {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  riskNote?: string;
  _count?: { suppliers: number };
}

const stageMap: Record<string, { label: string; color: string; bg: string }> = {
  DOWNLOAD: { label: '文件下载', color: '#0891b2', bg: '#0891b218' },
  SUBMIT: { label: '加密投递', color: '#064ea2', bg: '#064ea218' },
  OPENING: { label: '在线开标', color: '#f5a623', bg: '#f5a62318' },
  EVALUATING: { label: '专家评标', color: '#7c3aed', bg: '#7c3aed18' },
  ARCHIVED: { label: '已归档', color: '#11a874', bg: '#11a87418' },
};

export default function ProcurementPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<BidProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get<BidProject[]>('/bid/projects')
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter ? projects.filter(p => p.stage === filter) : projects;
  const counts = {
    all: projects.length,
    DOWNLOAD: projects.filter(p => p.stage === 'DOWNLOAD').length,
    SUBMIT: projects.filter(p => p.stage === 'SUBMIT').length,
    OPENING: projects.filter(p => p.stage === 'OPENING').length,
    EVALUATING: projects.filter(p => p.stage === 'EVALUATING').length,
    ARCHIVED: projects.filter(p => p.stage === 'ARCHIVED').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">采购管理</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">管理采购项目全生命周期：立项、编制招标文件、审查、发布</p>
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: '全部项目', value: counts.all, color: '#18243a' },
          { label: '文件下载', value: counts.DOWNLOAD, color: '#0891b2' },
          { label: '投递/开标', value: counts.SUBMIT + counts.OPENING, color: '#f5a623' },
          { label: '专家评标', value: counts.EVALUATING, color: '#7c3aed' },
          { label: '已归档', value: counts.ARCHIVED, color: '#11a874' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 筛选 */}
      <div className="flex gap-2 mb-4">
        {[{ key: '', label: '全部' }, ...Object.entries(stageMap).map(([k, v]) => ({ key: k, label: v.label }))].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${filter === f.key ? 'bg-[#064ea2] text-white shadow-md' : 'bg-white text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)] hover:border-[oklch(0.80_0.04_258)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* 项目列表 */}
      {loading ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center text-[oklch(0.55_0.01_264)]">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-12 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-2">暂无项目</h3>
          <p className="text-sm text-[oklch(0.55_0.01_264)]">当前没有符合条件的采购项目</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const stage = stageMap[p.stage] || { label: p.stage, color: '#5a6d8a', bg: '#5a6d8a18' };
            return (
              <div key={p.id} onClick={() => router.push('/bid')}
                className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 hover:shadow-md hover:border-[oklch(0.80_0.04_258)] transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#39a8ff] flex items-center justify-center text-white text-sm font-bold">
                      {p.name[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{p.name}</h3>
                      <p className="text-xs text-[oklch(0.55_0.01_264)]">{p.projectCode} · {p.procurementMethod}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ color: stage.color, backgroundColor: stage.bg }}>
                    {stage.label}
                  </span>
                </div>
                <div className="flex items-center gap-6 text-sm text-[oklch(0.55_0.01_264)]">
                  <span>投标单位：{p._count?.suppliers ?? 0} 家</span>
                  <span>开标时间：{new Date(p.openTime).toLocaleDateString('zh-CN')}</span>
                  <span>截止：{new Date(p.deadline).toLocaleDateString('zh-CN')}</span>
                  {p.riskNote && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded font-semibold">⚠ {p.riskNote}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
