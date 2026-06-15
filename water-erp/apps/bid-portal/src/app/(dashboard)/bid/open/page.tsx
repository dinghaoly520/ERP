'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import StartOpeningDialog from '@/components/start-opening-dialog';
import DisputeDialog from '@/components/dispute-dialog';
import AdminSubmitBidDialog from '@/components/admin-submit-bid-dialog';
import { Unlock, Clock, Shield, Play, CheckCircle, XCircle, AlertTriangle, ChevronRight, UserPlus } from 'lucide-react';
import { PageHero } from '@/components/workbench/page-hero';
import { SectionCard } from '@/components/workbench/section-card';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { DECRYPT_LABEL, SEMANTIC } from '@water-erp/shared';

const decryptColors: Record<string, { color: string; bg: string }> = {
  PENDING: { color: SEMANTIC.warning, bg: '#fef6e8' },
  RUNNING: { color: SEMANTIC.info, bg: '#eef4fc' },
  SUCCESS: { color: SEMANTIC.success, bg: '#f0faf6' },
  DANGER:  { color: SEMANTIC.danger, bg: '#fef2f2' },
};

export default function BidOpenPage() {
  const [projects, setProjects] = useState<{id:string}[]>([]);
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispute, setDispute] = useState<{recordId: string; supplierName: string; objectionReason?: string} | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [openingSubmission, setOpeningSubmission] = useState(false);
  const [showAdminSubmit, setShowAdminSubmit] = useState(false);

  const openingStatusMeta = (status?: string | null) => {
    switch (status) {
      case '供应商已确认': return { label: '供应商已确认', color: '#11a874', bg: '#f0faf6' };
      case '供应商提出异议': return { label: '供应商提出异议', color: '#e74c3c', bg: '#fef2f2' };
      case '异议已处理-确认': return { label: '异议已处理', color: '#11a874', bg: '#f0faf6' };
      case '异议已处理-退回': return { label: '异议已退回', color: '#6b7280', bg: '#f3f4f6' };
      case '待供应商确认': return { label: '待供应商确认', color: '#f5a623', bg: '#fef6e8' };
      default: return { label: status || '待确认', color: '#6b7280', bg: '#f3f4f6' };
    }
  };

  const handleResolveDispute = async (result: string, confirm: boolean) => {
    if (!dispute) return;
    await api.post(`/bid/projects/${projectId}/opening-records/${dispute.recordId}/resolve-dispute`, { result, confirm });
    const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
    setProject(updated);
    setDispute(null);
  };

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

  // WebSocket for live updates — replaces polling
  useBidWebSocket(projectId, {
    onDecrypt: (data) => {
      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          suppliers: prev.suppliers.map(s =>
            s.id === data.supplierId ? { ...s, decryptStatus: data.decryptStatus } : s,
          ),
        };
      });
    },
    onStageChange: () => {
      if (projectId) {
        api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
      }
    },
  });

  const handleDecrypt = async (sid: string) => {
    await api.post(`/bid/projects/${projectId}/decrypt/${sid}`, {});
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
  };

  const handleOpenSubmission = async () => {
    setOpeningSubmission(true);
    try {
      await api.post(`/bid/projects/${projectId}/open-submission`, {});
      const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(updated);
    } catch (e: any) {
      window.alert(e.message || '操作失败');
    } finally {
      setOpeningSubmission(false);
    }
  };

  const handleAdminSubmit = async (supplierName: string) => {
    await api.post(`/bid/projects/${projectId}/suppliers`, { supplierName });
    setShowAdminSubmit(false);
    const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
    setProject(updated);
  };

  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20 tracking-tight">暂无项目数据</div>;

  const session = project.openingSession;
  const remaining = session ? Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - Date.now()) / 1000)) : 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="开标大厅"
        tone="blue"
        icon={<Unlock size={14} strokeWidth={1.5} />}
        title="在线开标大厅"
        description="到时自动提取投标文件 · 提示在线解密 · 生成开标记录"
        actions={<ProjectSelector value={projectId} onChange={setProjectId} />}
      />

      {/* Session header */}
      {session && (
        <div className="rounded-2xl bg-gradient-to-r from-[#064ea2] to-[#0b63ce] text-white p-6 flex items-center gap-8">
          <div className="flex-1">
            <h2 className="text-lg font-black tracking-tight mb-2">
              {project.name}
            </h2>
            <div className="flex items-center gap-6 text-sm text-white/60">
              <span className="flex items-center gap-1.5"><Clock size={13} strokeWidth={1.5} /> {new Date(project.openTime).toLocaleString('zh-CN')}</span>
              <span>主持人：{session.host}</span>
              <span>监督人：{session.supervisor}</span>
            </div>
          </div>
          <div className="bg-white/10 rounded-xl px-6 py-3 text-center">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-1">状态</div>
            <div className="text-lg font-black tracking-tight">{session.status}</div>
          </div>
          {remaining > 0 && (
            <div className="bg-[#e74c3c]/80 rounded-xl px-6 py-3 text-center min-w-[100px]">
              <div className="text-xs text-white/60 uppercase tracking-widest mb-1">倒计时</div>
              <div className="text-xl font-bold font-mono tracking-tight">{String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}</div>
            </div>
          )}
        </div>
      )}

      {/* Decrypt status table */}
      <SectionCard className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5ecf4]">
          <h2 className="text-sm font-black text-[#18243a]">
            投标人在线解密状态
          </h2>
          <div className="flex items-center gap-2">
            {project.stage === 'DOWNLOAD' && (
              <button onClick={handleOpenSubmission} disabled={openingSubmission}
                className="flex items-center gap-1.5 rounded-xl bg-[#11a874] px-4 py-2 text-xs font-bold text-white hover:bg-[#0e8c5f] transition disabled:opacity-50">
                <ChevronRight size={13} strokeWidth={2} /> {openingSubmission ? '处理中…' : '开放投递'}
              </button>
            )}
            {project.stage !== 'OPENING' && (
              <button onClick={() => setStartOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#054280] transition">
                <Play size={13} strokeWidth={2} /> 启动开标
              </button>
            )}
            <button onClick={() => setShowAdminSubmit(true)}
              className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#064ea2] hover:bg-[#f8fafc] transition">
              <UserPlus size={13} strokeWidth={1.5} /> 代供应商提交
            </button>
          </div>
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
              const c = decryptColors[s.decryptStatus] || decryptColors.PENDING;
              const label = DECRYPT_LABEL[s.decryptStatus] || DECRYPT_LABEL.PENDING;
              return (
                <tr key={s.id} className="border-b border-[oklch(0.94_0.004_264)] hover:bg-[oklch(0.992_0.003_264)] transition-colors">
                  <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{s.supplierName}</td>
                  <td className="px-5 py-3 font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{s.receiptNo || '—'}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{s.encryptStatus}</td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: c.color, backgroundColor: c.bg }}>{label}</span>
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
      </SectionCard>

      {/* Opening records */}
      <SectionCard className="overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-[#e5ecf4]">
          <h2 className="text-sm font-black text-[#18243a]">
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
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody>
            {project.openingRecords.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无开标记录</td></tr>
            ) : project.openingRecords.map((r, i) => {
              const sm = openingStatusMeta(r.confirmStatus);
              return (
                <tr key={i} className="border-b border-[oklch(0.94_0.004_264)] align-top">
                  <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">
                    {r.supplierName}
                    {r.objectionReason && <div className="text-[11px] text-[oklch(0.50_0.18_22)] mt-1 font-normal">异议：{r.objectionReason}</div>}
                    {r.handleResult && <div className="text-[11px] text-[oklch(0.55_0.01_264)] mt-1 font-normal">处理：{r.handleResult}</div>}
                  </td>
                  <td className="px-5 py-3 font-mono font-bold text-[oklch(0.18_0.012_265)] tracking-tight">{r.amount}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.period}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.qualityTarget}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.bondStatus}</td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: sm.color, backgroundColor: sm.bg }}>{sm.label}</span>
                  </td>
                  <td className="px-5 py-3">
                    {r.confirmStatus === '供应商提出异议' && (
                      <button onClick={() => setDispute({ recordId: r.id, supplierName: r.supplierName, objectionReason: r.objectionReason ?? undefined })} disabled={!!dispute}
                        className="flex items-center gap-1 text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] tracking-tight transition-colors disabled:opacity-50">
                        <Shield size={12} strokeWidth={1.5} /> {dispute?.recordId === r.id ? '处理中…' : '处理异议'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      <StartOpeningDialog
        open={startOpen}
        projectId={projectId}
        onClose={() => setStartOpen(false)}
        onStarted={() => {
          setStartOpen(false);
          api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
        }}
      />
      {dispute && (
        <DisputeDialog
          open={!!dispute}
          recordId={dispute.recordId}
          supplierName={dispute.supplierName}
          objectionReason={dispute.objectionReason}
          onClose={() => setDispute(null)}
          onResolved={handleResolveDispute}
        />
      )}
      <AdminSubmitBidDialog
        open={showAdminSubmit}
        projectId={projectId}
        projectStage={project.stage}
        onClose={() => setShowAdminSubmit(false)}
        onSubmit={handleAdminSubmit}
      />
    </div>
  );
}
