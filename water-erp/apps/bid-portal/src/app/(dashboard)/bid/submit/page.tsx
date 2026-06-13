'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { Upload, Download, Shield, FileText } from 'lucide-react';

export default function BidSubmitPage() {
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

  if (loading) return <TableSkeleton rows={4} cols={4} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>供应商投标端</h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">文件受控下载 · 投标加密上传 · 回执生成</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Download */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Download size={16} strokeWidth={1.5} className="text-[oklch(0.42_0.14_260)]" />
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>招标文件受控下载</h2>
          </div>
          <div className="bg-[oklch(0.982_0.003_264)] border border-[oklch(0.91_0.006_264)] p-4 space-y-2">
            <p className="text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight"><strong>{project.projectCode}</strong> 招标文件.ofd</p>
            <p className="text-[12px] text-[oklch(0.55_0.01_264)]">动态水印已嵌入 · 哈希 SHA256-A19C8E</p>
            <p className="text-[11px] text-[oklch(0.72_0.008_264)]">下载即代表已阅读并同意招标文件的所有条款</p>
          </div>
        </div>

        {/* Upload */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Upload size={16} strokeWidth={1.5} className="text-[oklch(0.42_0.14_260)]" />
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>投标文件加密投递</h2>
          </div>
          <div className="border-2 border-dashed border-[oklch(0.91_0.006_264)] p-8 text-center">
            <FileText size={32} strokeWidth={1} className="text-[oklch(0.80_0.006_264)] mx-auto mb-3" />
            <p className="text-[13px] text-[oklch(0.55_0.01_264)] tracking-tight mb-1">拖拽投标文件到此处</p>
            <p className="text-[11px] text-[oklch(0.72_0.008_264)]">本地签章 → 哈希计算 → 加密上传 → 生成回执</p>
          </div>
        </div>
      </div>

      {/* Status table */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>投标状态</h2>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">投标单位</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">投递状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">加密状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">回执编号</th>
            </tr>
          </thead>
          <tbody>
            {project.suppliers.map(s => (
              <tr key={s.id} className="border-b border-[oklch(0.94_0.004_264)]">
                <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{s.supplierName}</td>
                <td className="px-5 py-3 text-[12px]">{s.submitStatus}</td>
                <td className="px-5 py-3 text-[12px]">{s.encryptStatus}</td>
                <td className="px-5 py-3 text-[oklch(0.42_0.14_260)] font-mono tracking-tight">{s.receiptNo || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
