'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { openingHallApi } from '@/lib/opening-hall';
import type { BidProjectDetail } from '@/lib/types';
import type { AnomalyDetectedPayload } from '@water-erp/shared';
import { getSupervisionAnnotations, upsertSupervisionAnnotation, deleteSupervisionAnnotation } from '@/lib/api/bid';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { TableSkeleton } from '@/components/skeleton';
import { Shield, AlertTriangle, Eye, Download, RefreshCw, Zap } from 'lucide-react';
import { SectionCard } from '@water-erp/ui';
import { toast } from 'sonner';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { useReportRealtime } from '@/contexts/bid-realtime-context';
import NoProjectGuide from '@/components/no-project-guide';

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

const TABS = [
  { key: 'overview', label: '监督总览' },
  { key: 'hall', label: '大厅交流' },
] as const;
type SuperviseTab = (typeof TABS)[number]['key'];

export default function BidSupervisePage() {
  const { projectId } = useBidProjectContext();
  const [tab, setTab] = useState<SuperviseTab>('overview');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [supervisionLogs, setSupervisionLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // AI/实时检测到的异常事件（与解密 DANGER 供应商一同在异常面板展示）
  const [anomalyEvents, setAnomalyEvents] = useState<AnomalyDetectedPayload[]>([]);
  // P3: actionable anomaly annotations (session-local flags/escalations/notes)
  const [anomalyFlags, setAnomalyFlags] = useState<Map<string, 'flagged' | 'escalated' | null>>(new Map());
  const [anomalyNotes, setAnomalyNotes] = useState<Map<string, string>>(new Map());
  const [annotatingId, setAnnotatingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setLoading(true);
    try {
      const p = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(p);
    } catch (e: any) {
      setError(e?.message || '加载项目数据失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // Load persisted annotations from API
  useEffect(() => {
    if (!projectId) return;
    getSupervisionAnnotations(projectId)
      .then(annotations => {
        const flagMap = new Map<string, 'flagged' | 'escalated' | null>();
        const noteMap = new Map<string, string>();
        annotations.forEach(a => {
          flagMap.set(a.supplierId, a.status === 'cleared' ? null : a.status as 'flagged' | 'escalated');
          if (a.notes) noteMap.set(a.supplierId, a.notes);
        });
        setAnomalyFlags(flagMap);
        setAnomalyNotes(noteMap);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (project?.supervisionLogs) {
      setSupervisionLogs(project.supervisionLogs);
    }
  }, [project]);

  const { connection, lastEventAt, reconnectNow } = useBidWebSocket(projectId || undefined, {
    onSupervisionLog: (data) => {
      setSupervisionLogs(prev => [data, ...prev]);
    },
    onStageChange: () => {
      if (projectId) {
        api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); });
      }
    },
    onAnomalyDetected: (data) => {
      if (data.severity === 'danger') toast.error(data.detail ?? '检测到异常');
      else toast.warning(data.detail ?? '检测到异常');
      setAnomalyEvents(prev => [data, ...prev].slice(0, 50));
    },
  });

  useReportRealtime(connection, lastEventAt, reconnectNow);

  if (!projectId) return <NoProjectGuide />;
  if (loading) return <TableSkeleton rows={6} cols={6} />;
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle size={28} strokeWidth={1.5} className="text-[#e74c3c] mb-3" />
        <p className="text-sm font-semibold text-[#5a6d8a] mb-4">{error}</p>
        <button onClick={loadProject} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#0b63ce] transition">
          <RefreshCw size={13} strokeWidth={1.5} /> 重试
        </button>
      </div>
    );
  }
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;
  if (!projectId) return null;

  const anomalies = project.suppliers.filter(s => s.decryptStatus === 'DANGER');

  return (
    <div className="space-y-6">
      {/* Permission notice */}
      <div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-5 flex items-center gap-4">
        <Shield size={20} strokeWidth={1.5} className="text-[#e74c3c] flex-shrink-0" />
        <div className="flex-1">
          <h2 className="text-sm font-bold text-[#18243a] mb-0.5">监督权限边界</h2>
          <p className="text-xs text-[#5a6d8a]">可查看过程、日志和异常，不具备开标前查看明文、修改评分、替专家提交意见的能力</p>
        </div>
        <span className="rounded-full border border-[#fecaca] bg-[#fef2f2] px-3 py-1 text-xs font-bold text-[#e74c3c]">禁止干预评分</span>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-[#e5ecf4]">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-bold transition ${
              tab === t.key
                ? 'border-[#064ea2] text-[#064ea2]'
                : 'border-transparent text-[oklch(0.55_0.01_264)] hover:text-[#18243a]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (<>
      <div className="grid grid-cols-[1fr_1fr] gap-6">
        {/* Timeline */}
        <SectionCard title="过程时间线">
          <div className="space-y-3">
            {supervisionLogs.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[oklch(0.62_0.008_264)] flex items-center justify-center gap-2">
                <Eye size={14} strokeWidth={1.5} /> 暂无监督日志
              </div>
            ) : supervisionLogs.map((log, i) => (
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
          {anomalies.length === 0 && anomalyEvents.length === 0 ? (
            <div className="bg-[oklch(0.96_0.02_260)] border border-[oklch(0.88_0.04_258)] p-4 text-[12px] text-[oklch(0.42_0.14_260)] flex items-center gap-2">
              <Eye size={14} strokeWidth={1.5} /> 当前无异常事件
            </div>
          ) : anomalies.map(s => {
            const flag = anomalyFlags.get(s.id);
            const note = anomalyNotes.get(s.id);
            const isAnnotating = annotatingId === s.id;
            return (
            <div key={s.id} className={`p-4 mb-2 border rounded-xl ${
              flag === 'escalated' ? 'bg-red-50 border-red-300' :
              flag === 'flagged' ? 'bg-amber-50 border-amber-300' :
              'bg-[oklch(0.96_0.04_85)] border-[oklch(0.88_0.06_82)]'
            }`}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} strokeWidth={1.5} className={`mt-0.5 flex-shrink-0 ${flag ? 'text-[#e74c3c]' : 'text-[oklch(0.64_0.16_82)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight font-semibold">{s.supplierName}</span>
                    <span className="text-[11px] text-[oklch(0.55_0.01_264)]">— 解密证书校验失败</span>
                    {flag && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        flag === 'escalated' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                      }`}>{flag === 'escalated' ? '已上报' : '关注中'}</span>
                    )}
                    {note && !isAnnotating && <span className="text-[10px] text-[oklch(0.62_0.008_264)] italic">· 有批注</span>}
                  </div>
                  {isAnnotating && (
                    <div className="mt-2 space-y-2">
                      <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                        placeholder="批注内容…" rows={3}
                        className="w-full border border-[oklch(0.91_0.006_264)] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#064ea2] resize-none" />
                      <div className="flex items-center gap-2">
                        <button onClick={async () => {
                          if (!projectId) return;
                          setAnomalyNotes(prev => { const m = new Map(prev); m.set(s.id, noteDraft); return m; });
                          setAnnotatingId(null);
                          const flag = anomalyFlags.get(s.id) || 'flagged';
                          try {
                            await upsertSupervisionAnnotation(projectId, {
                              supplierId: s.id, status: flag, notes: noteDraft,
                            });
                          } catch { /* silent */ }
                        }}
                          className="text-[11px] font-bold text-white bg-[#064ea2] px-3 py-1 rounded hover:bg-[#054280] transition">保存批注</button>
                        <button onClick={() => { setAnnotatingId(null); }} className="text-[11px] text-[oklch(0.55_0.01_264)] hover:underline">取消</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <button onClick={async () => {
                    if (!projectId) return;
                    const flag = anomalyFlags.get(s.id);
                    const newStatus = flag === 'flagged' ? null : 'flagged';
                    setAnomalyFlags(prev => { const m = new Map(prev); m.set(s.id, newStatus); return m; });
                    try {
                      if (newStatus) {
                        await upsertSupervisionAnnotation(projectId, { supplierId: s.id, status: newStatus });
                      } else {
                        await deleteSupervisionAnnotation(projectId, s.id);
                      }
                    } catch { /* silent */ }
                  }}
                    title="标记关注"
                    className={`text-[11px] font-bold px-2 py-1 rounded transition ${
                      flag === 'flagged' ? 'bg-amber-100 text-amber-600' : 'text-[oklch(0.62_0.008_264)] hover:bg-amber-50 hover:text-amber-600'
                    }`}>关注</button>
                  <button onClick={async () => {
                    if (!projectId) return;
                    const flag = anomalyFlags.get(s.id);
                    const newStatus = flag === 'escalated' ? null : 'escalated';
                    setAnomalyFlags(prev => { const m = new Map(prev); m.set(s.id, newStatus); return m; });
                    try {
                      if (newStatus) {
                        await upsertSupervisionAnnotation(projectId, { supplierId: s.id, status: newStatus });
                      } else {
                        await deleteSupervisionAnnotation(projectId, s.id);
                      }
                    } catch { /* silent */ }
                  }}
                    title="上报"
                    className={`text-[11px] font-bold px-2 py-1 rounded transition ${
                      flag === 'escalated' ? 'bg-red-100 text-red-600' : 'text-[oklch(0.62_0.008_264)] hover:bg-red-50 hover:text-red-600'
                    }`}>上报</button>
                  <button onClick={() => { setAnnotatingId(isAnnotating ? null : s.id); setNoteDraft(note || ''); }}
                    title="批注"
                    className={`text-[11px] font-bold px-2 py-1 rounded transition ${
                      isAnnotating ? 'bg-blue-100 text-[#064ea2]' : 'text-[oklch(0.62_0.008_264)] hover:bg-blue-50 hover:text-[#064ea2]'
                    }`}>批注</button>
                </div>
              </div>
            </div>
          )})}
          {anomalyEvents.map((ev, idx) => (
            <div key={`aiev-${idx}`} className={`p-4 mb-2 border rounded-xl ${ev.severity === 'danger' ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'}`}>
              <div className="flex items-start gap-2">
                <Zap size={14} strokeWidth={1.5} className={`mt-0.5 flex-shrink-0 ${ev.severity === 'danger' ? 'text-[#e74c3c]' : 'text-[#f5a623]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] font-semibold text-[#18243a]">{ev.supplierName || ev.type || '异常事件'}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ev.severity === 'danger' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>{ev.severity === 'danger' ? '危险' : '警告'}</span>
                    <span className="text-[10px] text-[#8a96aa] font-mono">{new Date(ev.timestamp).toLocaleTimeString('zh-CN')}</span>
                  </div>
                  <p className="text-[12px] text-[#5a6d8a]">{ev.detail}</p>
                </div>
              </div>
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
        <table className="workbench-table">
          <thead>
            <tr className="text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">时间</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">角色</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">对象</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">结果</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">风险</th>
            </tr>
          </thead>
          <tbody>
            {supervisionLogs.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无监督日志</td></tr>
            ) : supervisionLogs.map(log => (
              <tr key={log.id}>
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
      </>)}

      {tab === 'hall' && projectId && <HallExchangeReadonly projectId={projectId} />}
    </div>
  );
}

function HallExchangeReadonly({ projectId }: { projectId: string }) {
  const [publicMsgs, setPublicMsgs] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [privateMsgs, setPrivateMsgs] = useState<any[]>([]);

  useEffect(() => {
    openingHallApi.messages(projectId, { roomType: 'PUBLIC', limit: 100 })
      .then(r => setPublicMsgs(r.items)).catch(() => {});
    openingHallApi.unread(projectId).then(r => setSessions(r.sessions ?? [])).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!active) return;
    openingHallApi.messages(projectId, { roomType: 'PRIVATE', supplierId: active, limit: 100 })
      .then(r => setPrivateMsgs(r.items)).catch(() => {});
  }, [active, projectId]);

  const MsgList = ({ items }: { items: any[] }) => (
    <div className="max-h-[480px] space-y-2 overflow-y-auto">
      {items.length === 0 && <div className="py-8 text-center text-xs text-slate-400">暂无记录</div>}
      {items.map((m: any) => (
        <div key={m.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <div className="mb-0.5 text-[11px] text-slate-400">
            {m.senderRole === 'HOST' ? '主持人' : m.senderRole === 'SYSTEM' ? '系统' : m.senderName} · {new Date(m.createdAt).toLocaleString('zh-CN')}
          </div>
          <div className="whitespace-pre-wrap break-all">{m.content}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="mb-2 text-sm font-semibold">公聊记录</h4>
        <MsgList items={publicMsgs} />
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <h4 className="mb-2 text-sm font-semibold">私聊记录（按供应商）</h4>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {sessions.map((s: any) => (
            <button key={s.supplierId} onClick={() => setActive(s.supplierId)}
              className={`rounded-lg px-2 py-1 text-xs ${active === s.supplierId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {s.supplierName}
            </button>
          ))}
        </div>
        {active ? <MsgList items={privateMsgs} /> : <div className="text-xs text-slate-400">选择供应商查看私聊留痕</div>}
      </div>
    </div>
  );
}
