'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { Shield, AlertTriangle, Eye, Download } from 'lucide-react';
import { PageHero } from '@/components/workbench/page-hero';
import { SectionCard } from '@/components/workbench/section-card';
import { toast } from 'sonner';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';

function exportSupervisionCSV(logs: Array<{ time: string; role: string; target: string; action: string; result: string; riskFlag: string }>) {
  const BOM = '﻿';
  const headers = ['时间', '角色', '对象', '操作', '结果', '风险标识'];
  const escapeCSV = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = logs.map(l => [
    new Date(l.time).toLocaleString('zh-CN'),
    l.role,
    l.target,
    l.action,
    l.result,
    l.riskFlag,
  ].map(escapeCSV).join(','));
  const csv = BOM + [headers.join(','), ...rows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `监督日志_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast.success('导出成功');
}

export default function BidSupervisePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [supervisionLogs, setSupervisionLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => { if (ps.length) setProjectId(ps[0].id); });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); setLoading(false); });
  }, [projectId]);

  useEffect(() => {
    if (project?.supervisionLogs) {
      setSupervisionLogs(project.supervisionLogs);
    }
  }, [project]);

  useBidWebSocket(projectId || undefined, {
    onSupervisionLog: (data) => {
      setSupervisionLogs(prev => [data, ...prev]);
    },
    onStageChange: () => {
      if (projectId) {
        api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); });
      }
    },
  });

  if (loading) return <TableSkeleton rows={6} cols={6} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;

  const anomalies = project.suppliers.filter(s => s.decryptStatus === 'DANGER');

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="监督端"
        tone="orange"
        icon={<Shield size={14} strokeWidth={1.5} />}
        title="监督端"
        description="全程监督 · 不可干预"
        actions={<ProjectSelector value={projectId} onChange={setProjectId} />}
      />

      {/* Permission notice */}
      <div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-5 flex items-center gap-4">
        <Shield size={20} strokeWidth={1.5} className="text-[#e74c3c] flex-shrink-0" />
        <div className="flex-1">
          <h2 className="text-sm font-bold text-[#18243a] mb-0.5">监督权限边界</h2>
          <p className="text-xs text-[#5a6d8a]">可查看过程、日志和异常，不具备开标前查看明文、修改评分、替专家提交意见的能力</p>
        </div>
        <span className="rounded-full border border-[#fecaca] bg-[#fef2f2] px-3 py-1 text-xs font-bold text-[#e74c3c]">禁止干预评分</span>
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-6">
        {/* Timeline */}
        <SectionCard title="过程时间线">
          <div className="space-y-3">
            {supervisionLogs.map((log, i) => (
              <div key={log.id} className={`flex items-start gap-3 ${i === 0 ? '' : 'pt-3 border-t border-[oklch(0.94_0.004_264)]'}`}>
                <div className={`w-1.5 h-1.5 mt-2 flex-shrink-0 ${log.riskFlag && log.riskFlag !== '无' ? 'bg-[oklch(0.50_0.18_22)]' : 'bg-[oklch(0.42_0.14_260)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-[oklch(0.72_0.008_264)] font-mono">{new Date(log.time).toLocaleString('zh-CN')}</div>
                  <div className="text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight">{log.role} · {log.action}</div>
                  <div className="text-[12px] text-[oklch(0.55_0.01_264)]">{log.result}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Anomalies */}
        <SectionCard title="异常事件">
          {anomalies.length === 0 ? (
            <div className="bg-[oklch(0.96_0.02_260)] border border-[oklch(0.88_0.04_258)] p-4 text-[12px] text-[oklch(0.42_0.14_260)] flex items-center gap-2">
              <Eye size={14} strokeWidth={1.5} /> 当前无异常事件
            </div>
          ) : anomalies.map(s => (
            <div key={s.id} className="bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-4 mb-2 flex items-start gap-2">
              <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.64_0.16_82)] mt-0.5 flex-shrink-0" />
              <span className="text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight">{s.supplierName} — 解密证书校验失败</span>
            </div>
          ))}
        </SectionCard>
      </div>

      {/* Log table */}
      <SectionCard className="overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-[#e5ecf4] flex items-center justify-between">
          <h2 className="text-sm font-black text-[#18243a]">监督日志</h2>
          {supervisionLogs.length > 0 && (
            <button
              onClick={() => exportSupervisionCSV(supervisionLogs)}
              className="flex items-center gap-1.5 text-[12px] text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.30_0.12_260)] transition-colors"
            >
              <Download size={14} strokeWidth={1.5} />
              导出 CSV
            </button>
          )}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">时间</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">角色</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">对象</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">结果</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">风险</th>
            </tr>
          </thead>
          <tbody>
            {supervisionLogs.map(log => (
              <tr key={log.id} className="border-b border-[oklch(0.94_0.004_264)]">
                <td className="px-5 py-3 text-[12px] text-[oklch(0.55_0.01_264)] font-mono">{new Date(log.time).toLocaleString('zh-CN')}</td>
                <td className="px-5 py-3 text-[12px]">{log.role}</td>
                <td className="px-5 py-3 text-[12px]">{log.target}</td>
                <td className="px-5 py-3 text-[13px]">{log.action}</td>
                <td className="px-5 py-3 text-[12px]">{log.result}</td>
                <td className="px-5 py-3 text-[12px]">{log.riskFlag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}
