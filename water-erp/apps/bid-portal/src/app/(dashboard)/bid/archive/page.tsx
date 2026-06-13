'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { Archive, CheckCircle, AlertTriangle, Package } from 'lucide-react';

const statusDefs: Record<string, { label: string; color: string }> = {
  ARCHIVED: { label: '已归档', color: '#11a874' },
  PENDING_CONFIRM: { label: '待确认', color: '#f5a623' },
  NOT_STARTED: { label: '未开始', color: '#8a9aaa' },
};

export default function BidArchivePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); setLoading(false); });
  };

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => { if (ps.length) setProjectId(ps[0].id); });
  }, []);

  useEffect(() => { load(); }, [projectId]);

  if (loading) return <TableSkeleton rows={6} cols={4} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;

  const aItems = project.archiveItems;
  const archived = aItems.filter(a => a.status === 'ARCHIVED').length;
  const rate = aItems.length > 0 ? Math.round((archived / aItems.length) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>归档端</h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">资料归档 · 防篡改 · 统一管理</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {/* Status header */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5 mb-8 flex items-center gap-6">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            电子档案编号：ARCH-{project.projectCode}
          </h2>
          <p className="text-[12px] text-[oklch(0.62_0.008_264)] font-mono mt-0.5">HASH-CHAIN-{project.projectCode}-{Date.now().toString(16).toUpperCase().slice(0, 8)}</p>
        </div>
        <div className="text-center px-6">
          <div className="text-[2rem] font-bold font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{rate}%</div>
          <div className="text-[11px] text-[oklch(0.62_0.008_264)] uppercase tracking-wider">归档率</div>
        </div>
        <button onClick={async () => { await api.post(`/bid/projects/${projectId}/archive-all`, {}); toast.success('归档完成'); load(); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors">
          <Package size={14} strokeWidth={1.5} /> 一键归档
        </button>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-6">
        <div className="bg-white border border-[oklch(0.91_0.006_264)]">
          <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>归档资料清单</h2>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">资料名称</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">责任端</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">状态</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">哈希摘要</th>
              </tr>
            </thead>
            <tbody>
              {aItems.map(a => {
                const s = statusDefs[a.status] || { label: a.status, color: '#94a3b8' };
                return (
                  <tr key={a.id} className="border-b border-[oklch(0.94_0.004_264)]">
                    <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{a.name}</td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.55_0.01_264)]">{a.ownerRole}</td>
                    <td className="px-5 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: s.color, backgroundColor: `${s.color}18` }}>{s.label}</span></td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)] font-mono">{a.hashDigest || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight mb-4" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>缺失提醒</h2>
          <div className="space-y-2">
            {aItems.filter(a => a.status !== 'ARCHIVED').map(a => (
              <div key={a.id} className="flex items-start gap-2 bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-3">
                <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.64_0.16_82)] mt-0.5 flex-shrink-0" />
                <span className="text-[12px] text-[oklch(0.18_0.012_265)] tracking-tight">{a.name} — {statusDefs[a.status]?.label}</span>
              </div>
            ))}
            {archived > 0 && (
              <div className="flex items-start gap-2 bg-[oklch(0.96_0.03_158)] border border-[oklch(0.88_0.06_158)] p-3">
                <CheckCircle size={14} strokeWidth={1.5} className="text-[oklch(0.54_0.16_158)] mt-0.5 flex-shrink-0" />
                <span className="text-[12px] text-[oklch(0.18_0.012_265)] tracking-tight">{archived} 项已归档</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
