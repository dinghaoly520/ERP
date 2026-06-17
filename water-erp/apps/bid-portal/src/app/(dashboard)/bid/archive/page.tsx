'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { exportArchivePackage } from '@/lib/api/bid';
import type { BidProjectDetail } from '@/lib/types';
import { useBidProjects } from '@/hooks/use-bid-projects';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { STATUS_COLOR } from '@water-erp/shared';
import { Archive, CheckCircle, AlertTriangle, Package, Download } from 'lucide-react';
import { PageHero, SectionCard } from '@water-erp/ui';

export default function BidArchivePage() {
  const { projectId, setProjectId } = useBidProjects();
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`)
      .then(p => { setProject(p); })
      .catch((e: any) => { setError(e?.message || '加载归档数据失败'); toast.error(e?.message || '加载归档数据失败'); })
      .finally(() => setLoading(false));
  };

  const handleExportArchive = async (format: 'json' | 'csv') => {
    if (!project) return;
    try {
      if (format === 'csv') {
        const a = document.createElement('a');
        a.href = `/api/bid/projects/${projectId}/archive-package/export?format=csv`;
        a.download = `归档包_${project.projectCode}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
      } else {
        const data = await exportArchivePackage(projectId, 'json');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `归档包_${project.projectCode}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success('归档包导出成功');
    } catch { toast.error('导出失败'); }
  };

  useEffect(() => { load(); }, [projectId]);

  if (loading) return <TableSkeleton rows={6} cols={4} />;
  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)] mb-3" />
      <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{error}</p>
      <button onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#054280] transition">重试</button>
    </div>
  );
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;

  const aItems = project.archiveItems;
  const archived = aItems.filter(a => a.status === 'ARCHIVED').length;
  const rate = aItems.length > 0 ? Math.round((archived / aItems.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHero
        tone="green"
        icon={<Archive size={14} strokeWidth={1.5} />}
        title="归档端"
        description="资料归档 · 防篡改 · 统一管理"
        actions={<ProjectSelector value={projectId} onChange={setProjectId} />}
      />

      {/* Status header */}
      <SectionCard className="flex items-center gap-6">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            电子档案编号：ARCH-{project.projectCode}
          </h2>
          {(() => {
            // P0-4: 档案指纹 = 哈希链末端（最后归档项的真实 SHA-256 摘要）。
            const archived = aItems.filter(a => a.status === 'ARCHIVED' && a.hashDigest)
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            const root = archived.length > 0 ? archived[archived.length - 1].hashDigest! : '';
            return (
              <p className="text-[12px] text-[oklch(0.62_0.008_264)] font-mono mt-0.5 flex items-center gap-1.5"
                title={root || '归档后自动生成'}>
                <span className="text-[oklch(0.55_0.01_264)]">档案指纹：</span>
                {root ? (
                  <>
                    <span className="text-[oklch(0.42_0.14_260)]">{root.slice(0, 7)}…{root.slice(-6)}</span>
                    <button onClick={() => { navigator.clipboard.writeText(root); toast.success('档案指纹已复制'); }}
                      className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.42_0.14_260)] transition" title="复制完整指纹">⧉</button>
                  </>
                ) : (
                  <span className="text-[oklch(0.62_0.008_264)]">归档后自动生成</span>
                )}
              </p>
            );
          })()}
        </div>
        <div className="text-center px-6">
          <div className="text-[2rem] font-bold font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{rate}%</div>
          <div className="text-[11px] text-[oklch(0.62_0.008_264)] uppercase tracking-wider">归档率</div>
        </div>
        <div className="flex items-center gap-2">
        <button
          disabled={project.stage !== 'EVALUATING' || archiving}
          onClick={async () => {
            setArchiving(true);
            try {
              await api.post(`/bid/projects/${projectId}/archive-all`, {});
              toast.success('归档完成');
              load();
            } catch {
              toast.error('归档失败，请重试');
            } finally {
              setArchiving(false);
            }
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#054280] transition transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <Package size={14} strokeWidth={1.5} /> {archiving ? '归档中…' : project.stage === 'ARCHIVED' ? '已归档' : project.stage === 'EVALUATING' ? '一键归档' : '待评标完成'}
        </button>
        <button
          onClick={() => handleExportArchive('json')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#064ea2] text-[#064ea2] hover:bg-[#064ea2] hover:text-white transition transition-colors"
          title="导出 JSON（含完整哈希链）">
          <Download size={14} strokeWidth={1.5} /> 导出归档包 JSON
        </button>
        <button
          onClick={() => handleExportArchive('csv')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[oklch(0.62_0.008_264)] text-[oklch(0.42_0.14_260)] hover:bg-[oklch(0.94_0.004_264)] transition transition-colors text-xs"
          title="导出 CSV（含哈希验证摘要）">
          CSV
        </button>
        </div>
      </SectionCard>

      <div className="grid grid-cols-[2fr_1fr] gap-6">
        <SectionCard className="overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-[#e5ecf4]">
            <h2 className="text-sm font-black text-[#18243a]">归档资料清单</h2>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">资料名称</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">责任端</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">状态</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">归档时间</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">哈希摘要</th>
              </tr>
            </thead>
            <tbody>
              {aItems.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">尚未生成归档清单，点击「一键归档」将自动生成标准材料清单并归档。</td></tr>
              ) : aItems.map(a => {
                const s = STATUS_COLOR[a.status] || { label: a.status, color: '#94a3b8' };
                const digest = a.hashDigest;
                return (
                  <tr key={a.id} className="border-b border-[oklch(0.94_0.004_264)]">
                    <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{a.name}</td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.55_0.01_264)]">{a.ownerRole}</td>
                    <td className="px-5 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: s.color, backgroundColor: `${s.color}18` }}>{s.label}</span></td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)]">{a.archivedAt ? new Date(a.archivedAt).toLocaleString('zh-CN') : '—'}</td>
                    <td className="px-5 py-3 text-[12px] font-mono">
                      {digest ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[oklch(0.42_0.14_260)]" title={digest}>{digest.slice(0, 10)}…{digest.slice(-6)}</span>
                          <button onClick={() => { navigator.clipboard.writeText(digest); toast.success('哈希已复制'); }}
                            className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.42_0.14_260)] transition" title="复制完整哈希">⧉</button>
                        </span>
                      ) : <span className="text-[oklch(0.62_0.008_264)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard title="缺失提醒">
          <div className="space-y-2">
            {aItems.filter(a => a.status !== 'ARCHIVED').map(a => (
              <div key={a.id} className="flex items-start gap-2 bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-3">
                <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.64_0.16_82)] mt-0.5 flex-shrink-0" />
                <span className="text-[12px] text-[oklch(0.18_0.012_265)] tracking-tight">{a.name} — {STATUS_COLOR[a.status]?.label}</span>
              </div>
            ))}
            {archived > 0 && (
              <div className="flex items-start gap-2 bg-[oklch(0.96_0.03_158)] border border-[oklch(0.88_0.06_158)] p-3">
                <CheckCircle size={14} strokeWidth={1.5} className="text-[oklch(0.54_0.16_158)] mt-0.5 flex-shrink-0" />
                <span className="text-[12px] text-[oklch(0.18_0.012_265)] tracking-tight">{archived} 项已归档</span>
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
