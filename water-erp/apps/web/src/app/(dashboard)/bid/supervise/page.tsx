'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { Shield, AlertTriangle, Eye } from 'lucide-react';

export default function BidSupervisePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => { if (ps.length) setProjectId(ps[0].id); });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); setLoading(false); });
  }, [projectId]);

  if (loading) return <TableSkeleton rows={6} cols={6} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;

  const anomalies = project.suppliers.filter(s => s.decryptStatus === 'DANGER');

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>监督端</h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">全程监督 · 不可干预</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {/* Permission notice */}
      <div className="bg-[oklch(0.97_0.004_264)] border border-[oklch(0.88_0.06_22)] p-4 mb-8 flex items-center gap-4">
        <Shield size={20} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)] flex-shrink-0" />
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight mb-0.5">监督权限边界</h2>
          <p className="text-[12px] text-[oklch(0.55_0.01_264)]">可查看过程、日志和异常，不具备开标前查看明文、修改评分、替专家提交意见的能力</p>
        </div>
        <span className="text-[11px] font-bold text-[oklch(0.50_0.18_22)] bg-[oklch(0.96_0.03_22)] px-3 py-1 tracking-wide">禁止干预评分</span>
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-6 mb-8">
        {/* Timeline */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight mb-4" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            过程时间线
          </h2>
          <div className="space-y-3">
            {project.supervisionLogs.map((log, i) => (
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
        </div>

        {/* Anomalies */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight mb-4" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            异常事件
          </h2>
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
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>监督日志</h2>
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
            {project.supervisionLogs.map(log => (
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
      </div>
    </div>
  );
}
