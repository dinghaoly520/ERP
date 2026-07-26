'use client';

/**
 * 监督视图（嵌入开标大厅）——移植自已删除的 supervise/page.tsx。
 * 开标过程的只读留痕：权限边界、过程时间线、异常事件（解密 DANGER + AI 实时事件，
 * 支持关注/上报/批注持久化）、监督日志表（含 CSV 导出）、大厅交流只读。
 * F8：实时事件（supervision:log / anomaly:detected）改由开标大厅页面级 socket
 * 统一订阅后经 props 下传，避免同一 project room 双连接。
 */

import { useEffect, useMemo, useState } from 'react';
import { openingHallApi } from '@/lib/opening-hall';
import type { BidProjectDetail } from '@/lib/types';
import type { AnomalyDetectedPayload } from '@water-erp/shared';
import { getSupervisionAnnotations, upsertSupervisionAnnotation, deleteSupervisionAnnotation } from '@/lib/api/bid';
import { Shield, AlertTriangle, Eye, Download, Zap } from 'lucide-react';
import { toast } from 'sonner';

/** cgzxui 面板（取代 @water-erp/ui 的 SectionCard）——无边框玻璃静态卡 + hairline 标题行 */
function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`neu-card-static overflow-hidden ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-[oklch(0.6_0.04_258_/_0.14)] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[color:var(--foreground)]">{title}</h3>
        </div>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// 分段切换钮选中态：内凹按压
const SEG_ACTIVE = 'rounded-[7px] px-2 py-1 text-xs font-semibold text-[color:var(--foreground)] bg-[oklch(0.92_0.012_258)] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.18),inset_-2px_-2px_5px_oklch(1_0_0_/_0.6)] transition-all';

function exportSupervisionCSV(logs: Array<{ id?: string; time: string; role: string; target: string; action: string; result: string; riskFlag: string }>) {
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

export type SupervisionLog = { id: string; time: string; role: string; target: string; action: string; result: string; riskFlag: string };

export function SupervisionView({ projectId, project, liveLogs, anomalyEvents }: {
  projectId: string;
  project: BidProjectDetail;
  /** 页面级 socket 实时推送的监督日志（F8：避免双连接） */
  liveLogs: SupervisionLog[];
  /** 页面级 socket 实时推送的异常事件 */
  anomalyEvents: AnomalyDetectedPayload[];
}) {
  const [anomalyFlags, setAnomalyFlags] = useState<Map<string, 'flagged' | 'escalated' | null>>(new Map());
  const [anomalyNotes, setAnomalyNotes] = useState<Map<string, string>>(new Map());
  const [annotatingId, setAnnotatingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // 合并日志：实时日志按 id 对持久化集合去重后前置（全量重载后不重复）
  const logs = useMemo(() => {
    const persisted = (project.supervisionLogs ?? []) as SupervisionLog[];
    if (liveLogs.length === 0) return persisted;
    const seen = new Set(persisted.map(l => l.id).filter(Boolean));
    return [...liveLogs.filter(l => !l.id || !seen.has(l.id)), ...persisted];
  }, [project.supervisionLogs, liveLogs]);

  // 持久化批注（关注/上报/notes）
  useEffect(() => {
    getSupervisionAnnotations(projectId)
      .then(annotations => {
        const flagMap = new Map<string, 'flagged' | 'escalated' | null>();
        const noteMap = new Map<string, string>();
        annotations.forEach(a => {
          flagMap.set(a.supplierId, a.status === 'cleared' ? null : (a.status as 'flagged' | 'escalated'));
          if (a.notes) noteMap.set(a.supplierId, a.notes);
        });
        setAnomalyFlags(flagMap);
        setAnomalyNotes(noteMap);
      })
      .catch(() => {});
  }, [projectId]);

  const dangerSuppliers = project.suppliers.filter(s => s.decryptStatus === 'DANGER');

  const saveAnnotation = async (supplierId: string, status: 'flagged' | 'escalated' | null, notes?: string) => {
    setAnomalyFlags(prev => { const m = new Map(prev); m.set(supplierId, status); return m; });
    if (notes !== undefined) setAnomalyNotes(prev => { const m = new Map(prev); m.set(supplierId, notes); return m; });
    try {
      if (status) {
        await upsertSupervisionAnnotation(projectId, { supplierId, status, notes: notes ?? anomalyNotes.get(supplierId) });
      } else {
        await deleteSupervisionAnnotation(projectId, supplierId);
      }
    } catch { /* 静默：批注为辅助功能 */ }
  };

  return (
    <div className="space-y-5">
      {/* 权限边界 — 无边框 danger 色调面板 */}
      <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.66_0.175_27_/_0.1)] p-4">
        <Shield size={18} strokeWidth={1.5} className="flex-shrink-0 text-[var(--danger)]" />
        <div className="flex-1">
          <h2 className="mb-0.5 text-sm font-bold text-[color:var(--foreground)]">监督权限边界</h2>
          <p className="text-xs text-[color:var(--muted-foreground)]">可查看开标过程、日志和异常；不具备开标前查看明文、修改评分、替专家提交意见的能力</p>
        </div>
        <span className="rounded-full bg-[oklch(0.66_0.175_27_/_0.16)] px-3 py-1 text-xs font-bold text-[var(--danger)]">禁止干预评分</span>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* 过程时间线 */}
        <Panel title="过程时间线">
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-center text-[12px] text-[color:var(--muted-foreground)]">
                <Eye size={14} strokeWidth={1.5} /> 暂无监督日志
              </div>
            ) : logs.map((log, i) => (
              <div key={log.id ?? `${log.time}-${i}`} className={`flex items-start gap-3 ${i === 0 ? '' : 'border-t border-[oklch(0.6_0.04_258_/_0.12)] pt-3'}`}>
                <div className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${log.riskFlag && log.riskFlag !== '无' ? 'bg-[var(--danger)]' : 'bg-[var(--accent-strong)]'}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-[color:var(--muted-foreground)]">{new Date(log.time).toLocaleString('zh-CN')}</div>
                  <div className="text-[13px] tracking-tight text-[color:var(--foreground)]">{log.role} · {log.action}</div>
                  <div className="text-[12px] text-[color:var(--muted-foreground)]">{log.result}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* 异常事件 */}
        <Panel title="异常事件">
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {dangerSuppliers.length === 0 && anomalyEvents.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl bg-[oklch(0.62_0.16_251_/_0.1)] p-4 text-[12px] text-[color:var(--accent-strong)]">
                <Eye size={14} strokeWidth={1.5} /> 当前无异常事件
              </div>
            ) : (
              <>
                {dangerSuppliers.map(s => {
                  const flag = anomalyFlags.get(s.id);
                  const note = anomalyNotes.get(s.id);
                  const isAnnotating = annotatingId === s.id;
                  const tint =
                    flag === 'escalated' ? 'bg-[oklch(0.66_0.175_27_/_0.12)]' :
                    flag === 'flagged' ? 'bg-[oklch(0.78_0.12_83_/_0.16)]' :
                    'bg-[oklch(0.78_0.12_83_/_0.1)]';
                  return (
                    <div key={s.id} className={`mb-2 rounded-2xl p-4 ${tint}`}>
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} strokeWidth={1.5} className={`mt-0.5 flex-shrink-0 ${flag ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">{s.supplierName}</span>
                            <span className="text-[11px] text-[color:var(--muted-foreground)]">— 解密证书校验失败</span>
                            {flag && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${flag === 'escalated' ? 'bg-[oklch(0.66_0.175_27_/_0.16)] text-[var(--danger)]' : 'bg-[oklch(0.78_0.12_83_/_0.2)] text-[var(--warning)]'}`}>
                                {flag === 'escalated' ? '已上报' : '关注中'}
                              </span>
                            )}
                            {note && !isAnnotating && <span className="text-[10px] italic text-[color:var(--muted-foreground)]">· 有批注</span>}
                          </div>
                          {isAnnotating && (
                            <div className="mt-2 space-y-2">
                              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                                placeholder="批注内容…" rows={3}
                                className="w-full resize-none rounded-lg bg-[oklch(0.99_0.004_258)] px-3 py-1.5 text-xs text-[color:var(--foreground)] shadow-[inset_2px_2px_4px_oklch(0.55_0.03_258_/_0.08),inset_-2px_-2px_4px_oklch(1_0_0_/_0.6)] focus:outline-none" />
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => { void saveAnnotation(s.id, anomalyFlags.get(s.id) || 'flagged', noteDraft); setAnnotatingId(null); }}
                                  className="neu-btn-primary !h-[30px] !px-3 text-[11px]">保存批注</button>
                                <button type="button" onClick={() => setAnnotatingId(null)} className="text-[11px] text-[color:var(--muted-foreground)] hover:underline">取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="ml-2 flex flex-shrink-0 items-center gap-1.5">
                          <button type="button" onClick={() => void saveAnnotation(s.id, anomalyFlags.get(s.id) === 'flagged' ? null : 'flagged')}
                            title="标记关注"
                            className={flag === 'flagged' ? 'neu-btn-xs is-warning' : 'neu-btn-xs'}>关注</button>
                          <button type="button" onClick={() => void saveAnnotation(s.id, anomalyFlags.get(s.id) === 'escalated' ? null : 'escalated')}
                            title="上报"
                            className={flag === 'escalated' ? 'neu-btn-xs is-danger' : 'neu-btn-xs'}>上报</button>
                          <button type="button" onClick={() => { setAnnotatingId(isAnnotating ? null : s.id); setNoteDraft(note || ''); }}
                            title="批注"
                            className={isAnnotating ? 'neu-btn-xs is-info' : 'neu-btn-xs'}>批注</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {anomalyEvents.map((ev, idx) => (
                  <div key={`aiev-${idx}`} className={`mb-2 rounded-2xl p-4 ${ev.severity === 'danger' ? 'bg-[oklch(0.66_0.175_27_/_0.12)]' : 'bg-[oklch(0.78_0.12_83_/_0.14)]'}`}>
                    <div className="flex items-start gap-2">
                      <Zap size={14} strokeWidth={1.5} className={`mt-0.5 flex-shrink-0 ${ev.severity === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-[color:var(--foreground)]">{ev.supplierName || ev.type || '异常事件'}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ev.severity === 'danger' ? 'bg-[oklch(0.66_0.175_27_/_0.16)] text-[var(--danger)]' : 'bg-[oklch(0.78_0.12_83_/_0.2)] text-[var(--warning)]'}`}>
                            {ev.severity === 'danger' ? '危险' : '警告'}
                          </span>
                          <span className="font-mono text-[10px] text-[color:var(--muted-foreground)]">{new Date(ev.timestamp).toLocaleTimeString('zh-CN')}</span>
                        </div>
                        <p className="text-[12px] text-[color:var(--muted-foreground)]">{ev.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </Panel>
      </div>

      {/* 监督日志表 */}
      <section className="neu-card-static overflow-hidden">
        <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.14)] px-6 py-4">
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">监督日志</h2>
          {logs.length > 0 && (
            <button type="button" onClick={() => exportSupervisionCSV(logs)}
              className="neu-btn-xs is-info">
              <Download size={14} strokeWidth={1.5} /> 导出 CSV
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table is-dense w-full">
            <thead>
              <tr className="text-[color:var(--muted-foreground)]">
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">时间</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">角色</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">对象</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">操作</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">结果</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">风险</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无监督日志</td></tr>
              ) : logs.map((log, i) => (
                <tr key={log.id ?? `${log.time}-${i}`}>
                  <td className="px-5 py-3 font-mono text-[12px] text-[color:var(--muted-foreground)]">{new Date(log.time).toLocaleString('zh-CN')}</td>
                  <td className="px-5 py-3 text-[12px] text-[color:var(--foreground)]">{log.role}</td>
                  <td className="px-5 py-3 text-[12px] text-[color:var(--foreground)]">{log.target}</td>
                  <td className="px-5 py-3 text-[13px] text-[color:var(--foreground)]">{log.action}</td>
                  <td className="px-5 py-3 text-[12px] text-[color:var(--foreground)]">{log.result}</td>
                  <td className="px-5 py-3 text-[12px] text-[color:var(--foreground)]">{log.riskFlag}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 大厅交流只读 */}
      <HallExchangeReadonly projectId={projectId} />
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
    <div className="max-h-[320px] space-y-2 overflow-y-auto">
      {items.length === 0 && <div className="py-6 text-center text-xs text-[color:var(--muted-foreground)]">暂无记录</div>}
      {items.map((m: any) => (
        <div key={m.id} className="rounded-lg bg-[oklch(0.985_0.006_258)] px-3 py-2 text-sm text-[color:var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.7),2px_2px_4px_oklch(0.55_0.03_258_/_0.08),-1px_-1px_3px_oklch(1_0_0_/_0.8)]">
          <div className="mb-0.5 text-[11px] text-[color:var(--muted-foreground)]">
            {m.senderRole === 'HOST' ? '主持人' : m.senderRole === 'SYSTEM' ? '系统' : m.senderName} · {new Date(m.createdAt).toLocaleString('zh-CN')}
          </div>
          <div className="whitespace-pre-wrap break-all">{m.content}</div>
        </div>
      ))}
    </div>
  );

  return (
    <Panel title="大厅交流（只读留痕）">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="neu-card-static p-4">
          <h4 className="mb-2 text-sm font-semibold text-[color:var(--foreground)]">公聊记录</h4>
          <MsgList items={publicMsgs} />
        </div>
        <div className="neu-card-static p-4">
          <h4 className="mb-2 text-sm font-semibold text-[color:var(--foreground)]">私聊记录（按供应商）</h4>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {sessions.map((s: any) => (
              <button key={s.supplierId} type="button" onClick={() => setActive(s.supplierId)}
                className={active === s.supplierId ? `${SEG_ACTIVE} whitespace-nowrap` : 'neu-btn-xs whitespace-nowrap'}>
                {s.supplierName}
              </button>
            ))}
          </div>
          {active ? <MsgList items={privateMsgs} /> : <div className="text-xs text-[color:var(--muted-foreground)]">选择供应商查看私聊留痕</div>}
        </div>
      </div>
    </Panel>
  );
}
