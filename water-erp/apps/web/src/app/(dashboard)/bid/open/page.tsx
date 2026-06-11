'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { Unlock, Clock, Shield, Play, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const decryptDefs: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待解密', color: '#f5a623', bg: '#fef6e8' },
  RUNNING: { label: '解密中', color: '#064ea2', bg: '#eef4fc' },
  SUCCESS: { label: '解密成功', color: '#11a874', bg: '#f0faf6' },
  DANGER:  { label: '异常', color: '#e74c3c', bg: '#fef2f2' },
};

export default function BidOpenPage() {
  const [projects, setProjects] = useState<{id:string}[]>([]);
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => {
      setProjects(ps);
      if (ps.length) setProjectId(ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); setLoading(false); });
  }, [projectId]);

  // Auto-refresh
  useEffect(() => {
    if (!projectId || !project || project.stage !== 'OPENING') return;
    const t = setInterval(() => api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject), 5000);
    return () => clearInterval(t);
  }, [projectId, project?.stage]);

  const handleDecrypt = async (sid: string) => {
    await api.post(`/bid/projects/${projectId}/decrypt/${sid}`, {});
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
  };

  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20 tracking-tight">暂无项目数据</div>;

  const session = project.openingSession;
  const remaining = session ? Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - Date.now()) / 1000)) : 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            在线开标大厅
          </h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">到时自动提取投标文件 · 提示在线解密 · 生成开标记录</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {/* Session header */}
      {session && (
        <div className="bg-[oklch(0.18_0.045_262)] text-white p-6 mb-8 flex items-center gap-8">
          <div className="flex-1">
            <h2 className="text-lg font-bold tracking-tight mb-2" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
              {project.name}
            </h2>
            <div className="flex items-center gap-6 text-[13px] text-white/60">
              <span className="flex items-center gap-1.5"><Clock size={13} strokeWidth={1.5} /> {new Date(project.openTime).toLocaleString('zh-CN')}</span>
              <span>主持人：{session.host}</span>
              <span>监督人：{session.supervisor}</span>
            </div>
          </div>
          <div className="bg-white/[0.06] px-6 py-3 text-center">
            <div className="text-[11px] text-white/40 uppercase tracking-widest mb-1">状态</div>
            <div className="text-[18px] font-bold tracking-tight">{session.status}</div>
          </div>
          {remaining > 0 && (
            <div className="bg-[oklch(0.50_0.18_22)]/80 px-6 py-3 text-center min-w-[100px]">
              <div className="text-[11px] text-white/60 uppercase tracking-widest mb-1">倒计时</div>
              <div className="text-xl font-bold font-mono tracking-tight">{String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}</div>
            </div>
          )}
        </div>
      )}

      {/* Decrypt status table */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)] mb-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            投标人在线解密状态
          </h2>
          {project.stage !== 'OPENING' && (
            <button onClick={async () => { await api.post(`/bid/projects/${projectId}/open`, {}); api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors">
              <Play size={13} strokeWidth={2} /> 启动开标
            </button>
          )}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">投标单位</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">回执编号</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">密文状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">解密状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">确认</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody>
            {project.suppliers.map(s => {
              const d = decryptDefs[s.decryptStatus] || decryptDefs.PENDING;
              return (
                <tr key={s.id} className="border-b border-[oklch(0.94_0.004_264)] hover:bg-[oklch(0.992_0.003_264)] transition-colors">
                  <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{s.supplierName}</td>
                  <td className="px-5 py-3 font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{s.receiptNo || '—'}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{s.encryptStatus}</td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: d.color, backgroundColor: d.bg }}>{d.label}</span>
                  </td>
                  <td className="px-5 py-3">
                    {s.confirmStatus === 'CONFIRMED' ? (
                      <span className="flex items-center gap-1 text-[oklch(0.54_0.16_158)] text-[12px]"><CheckCircle size={12} strokeWidth={1.5} /> 已确认</span>
                    ) : s.confirmStatus === 'EXCEPTION' ? (
                      <span className="flex items-center gap-1 text-[oklch(0.50_0.18_22)] text-[12px]"><AlertTriangle size={12} strokeWidth={1.5} /> 异常</span>
                    ) : (
                      <span className="text-[oklch(0.62_0.008_264)] text-[12px]">待确认</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {s.decryptStatus !== 'SUCCESS' && (
                      <button onClick={() => handleDecrypt(s.id)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] tracking-tight transition-colors">
                        <Unlock size={12} strokeWidth={1.5} /> 解密
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Opening records */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            开标记录
          </h2>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">供应商</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">报价</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">工期</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">质量</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">保证金</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">确认状态</th>
            </tr>
          </thead>
          <tbody>
            {project.openingRecords.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无开标记录</td></tr>
            ) : project.openingRecords.map((r, i) => (
              <tr key={i} className="border-b border-[oklch(0.94_0.004_264)]">
                <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{r.supplierName}</td>
                <td className="px-5 py-3 font-mono font-bold text-[oklch(0.18_0.012_265)] tracking-tight">{r.amount}</td>
                <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.period}</td>
                <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.qualityTarget}</td>
                <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.bondStatus}</td>
                <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.confirmStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
