'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { STATUS_COLOR } from '@water-erp/shared';
import { Archive, CheckCircle, AlertTriangle, Package, Download } from 'lucide-react';
import { PageHero, SectionCard } from '@water-erp/ui';

export default function BidArchivePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); setLoading(false); });
  };

  const handleExportArchive = () => {
    if (!project) return;

    const BOM = '﻿';
    const lines: string[] = [];

    const esc = (v: unknown) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    // Section 1: 招标项目基础信息
    lines.push('招标项目基础信息');
    lines.push(['项目编号', '项目名称', '采购方式', '开标时间', '截标时间', '当前阶段', '风险备注'].map(esc).join(','));
    lines.push([
      project.projectCode, project.name, project.procurementMethod,
      project.openTime, project.deadline, project.stage, project.riskNote || '',
    ].map(esc).join(','));
    lines.push('');

    // Section 2: 投标供应商名单
    lines.push('投标供应商名单');
    lines.push(['供应商名称', '下载状态', '提交状态', '加密状态', '回执编号', '解密状态', '确认状态'].map(esc).join(','));
    for (const s of project.suppliers) {
      lines.push([
        s.supplierName, s.downloadStatus, s.submitStatus, s.encryptStatus,
        s.receiptNo || '', s.decryptStatus, s.confirmStatus,
      ].map(esc).join(','));
    }
    lines.push('');

    // Section 3: 开标记录表
    lines.push('开标记录表');
    lines.push(['供应商名称', '报价金额', '工期', '质量目标', '保证金状态', '解密结果', '确认状态', '异议原因', '处理结果'].map(esc).join(','));
    for (const r of project.openingRecords) {
      lines.push([
        r.supplierName, r.amount, r.period, r.qualityTarget, r.bondStatus,
        r.decryptResult, r.confirmStatus, r.objectionReason || '', r.handleResult || '',
      ].map(esc).join(','));
    }

    const csv = BOM + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `归档包_${project.projectCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('归档包导出成功');
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
    <div className="space-y-6">
      <PageHero
        eyebrow="归档端"
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
          <p className="text-[12px] text-[oklch(0.62_0.008_264)] font-mono mt-0.5">HASH-CHAIN-{project.projectCode}-{Date.now().toString(16).toUpperCase().slice(0, 8)}</p>
        </div>
        <div className="text-center px-6">
          <div className="text-[2rem] font-bold font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{rate}%</div>
          <div className="text-[11px] text-[oklch(0.62_0.008_264)] uppercase tracking-wider">归档率</div>
        </div>
        <div className="flex items-center gap-2">
        <button
          disabled={project.stage === 'ARCHIVED' || archiving}
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
          <Package size={14} strokeWidth={1.5} /> {archiving ? '归档中…' : project.stage === 'ARCHIVED' ? '已归档' : '一键归档'}
        </button>
        <button
          onClick={handleExportArchive}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#064ea2] text-[#064ea2] hover:bg-[#064ea2] hover:text-white transition transition-colors">
          <Download size={14} strokeWidth={1.5} /> 导出归档包
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
                return (
                  <tr key={a.id} className="border-b border-[oklch(0.94_0.004_264)]">
                    <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{a.name}</td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.55_0.01_264)]">{a.ownerRole}</td>
                    <td className="px-5 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: s.color, backgroundColor: `${s.color}18` }}>{s.label}</span></td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)]">{a.archivedAt ? new Date(a.archivedAt).toLocaleString('zh-CN') : '—'}</td>
                    <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)] font-mono">{a.hashDigest || '—'}</td>
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
