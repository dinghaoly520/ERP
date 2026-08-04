'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Gavel, AlertTriangle, CheckCircle2, ChevronRight,
  RefreshCw, ClipboardCheck, UserCircle, Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ExpertProject, User } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

const VOTE_LABEL: Record<string, string> = { approve: '赞成', reject: '反对', abstain: '弃权' };

// /expert/tasks 返回的表决/异议（与 /tasks 页共享类型结构）
interface MotionItem {
  id: string; projectId: string; projectName: string; projectStage: string;
  title: string; status: string; result?: string | null; myVote: string | null;
  votes: Array<{ expertId: string; vote: string }>;
}
interface DisputeItem {
  id: string; projectId: string; projectName: string;
  title: string; status: string;
}
interface MyTasks { motions: MotionItem[]; disputes: DisputeItem[]; }

export default function ExpertDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ExpertProject[]>([]);
  const [tasks, setTasks] = useState<MyTasks | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.allSettled([
      fetch('/api/auth/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(setUser),
      api.get<ExpertProject[]>('/expert/projects').then(setProjects).catch((e) => toast.error(`加载项目失败: ${e.message}`)),
      api.get<MyTasks>('/expert/tasks').then(setTasks).catch(() => { /* 无待办不阻断 */ }),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const isActive = (stage: string) => stage === 'OPENING' || stage === 'EVALUATING';

  // ── 发起表决 / 提交异议 ──
  const [busy, setBusy] = useState(false);
  const [showMotionForm, setShowMotionForm] = useState(false);
  const [motionForm, setMotionForm] = useState({ projectId: '', title: '', description: '' });
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeForm, setDisputeForm] = useState({ projectId: '', title: '', content: '' });

  const activeProjects = useMemo(
    () => projects.filter(p => isActive(p.project.stage)),
    [projects],
  );
  const isLeadAnywhere = useMemo(
    () => activeProjects.some(p => p.isLead),
    [activeProjects],
  );

  const openMotionForm = () => {
    if (activeProjects.length === 1 && !motionForm.projectId) {
      setMotionForm(prev => ({ ...prev, projectId: activeProjects[0].project.id }));
    }
    setShowDisputeForm(false);
    setShowMotionForm(prev => !prev);
  };
  const openDisputeForm = () => {
    if (activeProjects.length === 1 && !disputeForm.projectId) {
      setDisputeForm(prev => ({ ...prev, projectId: activeProjects[0].project.id }));
    }
    setShowMotionForm(false);
    setShowDisputeForm(prev => !prev);
  };

  async function handleCreateMotion() {
    if (!motionForm.projectId || !motionForm.title.trim()) { toast.error('请选择项目并填写表决标题'); return; }
    setBusy(true);
    try {
      await api.post(`/expert/projects/${motionForm.projectId}/motions`, { title: motionForm.title, description: motionForm.description, type: 'other' });
      setMotionForm({ projectId: '', title: '', description: '' }); setShowMotionForm(false);
      toast.success('表决已发起'); reloadTasks();
    } catch (e: any) { toast.error(e.message || '发起失败'); }
    finally { setBusy(false); }
  }
  async function handleDisputeSubmit() {
    if (!disputeForm.projectId || !disputeForm.title.trim() || !disputeForm.content.trim()) { toast.error('请选择项目并填写异议标题和内容'); return; }
    setBusy(true);
    try {
      await api.post(`/expert/projects/${disputeForm.projectId}/disputes`, { title: disputeForm.title, content: disputeForm.content, type: 'scoring' });
      setDisputeForm({ projectId: '', title: '', content: '' }); setShowDisputeForm(false);
      toast.success('异议已提交'); reloadTasks();
    } catch (e: any) { toast.error(e.message || '提交失败'); }
    finally { setBusy(false); }
  }
  function reloadTasks() {
    api.get<MyTasks>('/expert/tasks').then(setTasks).catch(() => {});
  }
  async function handleVote(motionId: string, vote: string) {
    setBusy(true);
    try { await api.post(`/expert/motions/${motionId}/vote`, { vote }); toast.success('投票成功'); reloadTasks(); }
    catch (e: any) { toast.error(e.message || '投票失败'); }
    finally { setBusy(false); }
  }
  async function handleCloseMotion(motionId: string) {
    setBusy(true);
    try { await api.post(`/expert/motions/${motionId}/close`, {}); toast.success('决议已形成'); reloadTasks(); }
    catch (e: any) { toast.error(e.message || '操作失败'); }
    finally { setBusy(false); }
  }

  // ── 派生数据 ──

  const pendingSignin = useMemo(
    () => projects.filter(p => isActive(p.project.stage) && !p.signedIn),
    [projects],
  );
  const activeMotions = useMemo(
    () => tasks?.motions ?? [],
    [tasks],
  );
  const activeDisputes = useMemo(
    () => tasks?.disputes ?? [],
    [tasks],
  );
  const pendingMotionCount = activeMotions.filter(m => !m.myVote).length;
  const pendingDisputeCount = activeDisputes.filter(d => d.status === 'open').length;

  const inProgress = useMemo(
    () => projects.filter(p => isActive(p.project.stage) && p.signedIn),
    [projects],
  );
  const completed = useMemo(
    () => projects.filter(p => p.project.stage === 'ARCHIVED'),
    [projects],
  );

  const totalPending = pendingSignin.length + pendingMotionCount + pendingDisputeCount;

  return (
    <div className="space-y-5">
      {/* 页面标题 */}
      <div className="page-hero">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="page-hero__icon"><UserCircle size={18} strokeWidth={1.5} /></div>
            <div>
              <div className="page-hero__title">欢迎，{user?.displayName || '专家'}</div>
              <div className="page-hero__sub">在线开标 · 专家评审 · 过程留痕</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalPending > 0 && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums text-white" style={{ background: 'var(--warning)' }}>
                {totalPending} 项待处理
              </span>
            )}
            <button onClick={load} disabled={loading} className="neu-btn-xs is-square !h-[30px] !w-[30px]" title="刷新">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-card-static rounded-2xl px-6 py-12 text-center">
          <ClipboardCheck size={28} strokeWidth={1.2} className="mx-auto mb-3 animate-pulse text-[var(--muted-foreground)]" />
          <p className="text-xs text-[var(--muted-foreground)]">加载工作台…</p>
        </div>
      ) : (
        <>
          {/* ====== 🔴 待处理事项 ====== */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${totalPending > 0 ? 'animate-pulse' : ''}`} style={{ background: totalPending > 0 ? 'var(--warning)' : 'var(--success)' }} />
                <h3 className="text-sm font-bold text-[var(--foreground)]">待处理事项</h3>
                {totalPending > 0 && <span className="text-xs font-semibold tabular-nums text-[var(--warning)]">{totalPending}</span>}
              </div>
              {isLeadAnywhere && (
                <div className="flex items-center gap-1.5">
                  <button onClick={openMotionForm} className="neu-btn-soft !h-[26px] !text-[11px]">
                    <Plus size={11} /> {showMotionForm ? '取消' : '发起表决'}
                  </button>
                  <button onClick={openDisputeForm} className="neu-btn-soft !h-[26px] !text-[11px] !text-[var(--danger)]">
                    <Plus size={11} /> {showDisputeForm ? '取消' : '提交异议'}
                  </button>
                </div>
              )}
            </div>

            {/* 发起表决表单 */}
            {showMotionForm && (
              <div className="neu-card-static mb-3 rounded-xl p-4 space-y-3">
                {activeProjects.length > 1 && (
                  <select className="workbench-input w-full"
                    value={motionForm.projectId}
                    onChange={e => setMotionForm(p => ({ ...p, projectId: e.target.value }))}>
                    <option value="" disabled>选择项目</option>
                    {activeProjects.map(p => (
                      <option key={p.project.id} value={p.project.id}>
                        {p.project.name} · {STAGE_LABEL[p.project.stage as keyof typeof STAGE_LABEL] ?? p.project.stage}
                      </option>
                    ))}
                  </select>
                )}
                <input className="workbench-input w-full" placeholder="表决标题"
                  value={motionForm.title}
                  onChange={e => setMotionForm(p => ({ ...p, title: e.target.value }))} />
                <textarea className="workbench-input w-full !min-h-[48px]" placeholder="表决说明（选填）"
                  value={motionForm.description}
                  onChange={e => setMotionForm(p => ({ ...p, description: e.target.value }))} />
                <button onClick={handleCreateMotion} disabled={busy || !motionForm.title.trim()}
                  className="neu-btn-primary !h-[32px] !text-xs">{busy ? '发起中…' : '发起表决'}</button>
              </div>
            )}

            {/* 提交异议表单 */}
            {showDisputeForm && (
              <div className="neu-card-static mb-3 rounded-xl p-4 space-y-3">
                {activeProjects.length > 1 && (
                  <select className="workbench-input w-full"
                    value={disputeForm.projectId}
                    onChange={e => setDisputeForm(p => ({ ...p, projectId: e.target.value }))}>
                    <option value="" disabled>选择项目</option>
                    {activeProjects.map(p => (
                      <option key={p.project.id} value={p.project.id}>
                        {p.project.name} · {STAGE_LABEL[p.project.stage as keyof typeof STAGE_LABEL] ?? p.project.stage}
                      </option>
                    ))}
                  </select>
                )}
                <input className="workbench-input w-full" placeholder="异议标题"
                  value={disputeForm.title}
                  onChange={e => setDisputeForm(p => ({ ...p, title: e.target.value }))} />
                <textarea className="workbench-input w-full !min-h-[64px]" placeholder="异议详细内容"
                  value={disputeForm.content}
                  onChange={e => setDisputeForm(p => ({ ...p, content: e.target.value }))} />
                <button onClick={handleDisputeSubmit} disabled={busy || !disputeForm.title.trim() || !disputeForm.content.trim()}
                  className="neu-btn-primary !h-[32px] !text-xs">{busy ? '提交中…' : '提交异议工单'}</button>
              </div>
            )}

            {(pendingSignin.length === 0 && activeMotions.length === 0 && activeDisputes.length === 0) ? (
              <div className="neu-card-static rounded-2xl px-6 py-8 text-center">
                <CheckCircle2 size={24} strokeWidth={1.4} className="mx-auto mb-2 text-[var(--success)]" />
                <p className="text-xs font-semibold text-[var(--foreground)]">暂无待处理事项</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">所有签到、投票、异议均已处理</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* 待签到 */}
                {pendingSignin.length > 0 && (
                  <TaskGroup icon={<ShieldCheck size={14} strokeWidth={1.8} />} color="var(--warning)" label="待签到" count={pendingSignin.length}>
                    {pendingSignin.map(p => (
                      <TaskRow key={p.id} name={p.project.name} stage={p.project.stage} onClick={() => router.push(`/evaluate/${p.project.id}`)} />
                    ))}
                  </TaskGroup>
                )}
                {/* 表决记录（投票中 + 已结束，持续显示至项目结束） */}
                {activeMotions.length > 0 && (
                  <TaskGroup icon={<Gavel size={14} strokeWidth={1.8} />} color="var(--accent)" label="表决记录" count={activeMotions.length}>
                    {activeMotions.map(m => {
                      const approves = m.votes.filter(v => v.vote === 'approve').length;
                      const rejects = m.votes.filter(v => v.vote === 'reject').length;
                      const total = m.votes.length;
                      const sc = STAGE_COLOR[m.projectStage as keyof typeof STAGE_COLOR];
                      const isVoting = m.status === 'voting';
                      const needVote = isVoting && !m.myVote;
                      return (
                        <div key={m.id} className={`rounded-lg px-2 py-2 ${needVote ? '' : 'opacity-50'}`}>
                          <div className="flex items-center gap-2 text-xs mb-1.5">
                            <span className="truncate font-semibold text-[var(--foreground)]">{m.projectName}</span>
                            {sc && (
                              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: `color-mix(in oklch, ${sc} 12%, transparent)`, color: sc }}>
                                {STAGE_LABEL[m.projectStage as keyof typeof STAGE_LABEL] ?? m.projectStage}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                              style={{
                                background: needVote ? 'color-mix(in oklch, var(--warning) 14%, transparent)' : 'color-mix(in oklch, var(--muted-foreground) 10%, transparent)',
                                color: needVote ? 'var(--warning)' : 'var(--muted-foreground)',
                              }}>
                              {isVoting ? (m.myVote ? `已投：${VOTE_LABEL[m.myVote] ?? m.myVote}` : '待投票') : (
                                m.result === 'approved' ? '✓ 通过' : m.result === 'rejected' ? '✗ 否决' : '△ 平票'
                              )}
                            </span>
                          </div>
                          <p className="text-[11px] font-semibold text-[var(--foreground)] mb-1">{m.title}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                              赞成 {approves} · 反对 {rejects} / {total}
                            </span>
                            <div className="flex items-center gap-2">
                              {needVote && (
                                <div className="flex gap-1">
                                  <button onClick={() => handleVote(m.id, 'approve')} disabled={busy}
                                    className="neu-btn-soft !h-[24px] !text-[10px] !text-[var(--success)]">赞成</button>
                                  <button onClick={() => handleVote(m.id, 'reject')} disabled={busy}
                                    className="neu-btn-soft !h-[24px] !text-[10px] !text-[var(--danger)]">反对</button>
                                  <button onClick={() => handleVote(m.id, 'abstain')} disabled={busy}
                                    className="neu-btn-soft !h-[24px] !text-[10px]">弃权</button>
                                </div>
                              )}
                              {isVoting && isLeadAnywhere && (
                                <button onClick={() => handleCloseMotion(m.id)} disabled={busy}
                                  className="neu-btn-soft is-warning !h-[24px] !text-[10px] ml-auto">结束投票·形成决议</button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </TaskGroup>
                )}
                {/* 异议工单（持续显示至项目结束） */}
                {activeDisputes.length > 0 && (
                  <TaskGroup icon={<AlertTriangle size={14} strokeWidth={1.8} />} color="var(--danger)" label="异议工单" count={activeDisputes.length}>
                    {activeDisputes.map(d => {
                      const isOpen = d.status === 'open';
                      return (
                        <div key={d.id} className={`rounded-lg px-2 py-1.5 ${isOpen ? '' : 'opacity-50'}`}>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="truncate font-semibold text-[var(--foreground)]">{d.projectName}</span>
                            <span className="truncate text-[11px] text-[var(--muted-foreground)]">· {d.title}</span>
                            <span className={`ml-auto shrink-0 text-[10px] font-semibold ${
                              isOpen ? 'text-[var(--warning)]' : d.status === 'resolved' ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                            }`}>
                              {isOpen ? '待裁决' : d.status === 'resolved' ? '已采纳' : '已驳回'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </TaskGroup>
                )}
              </div>
            )}
          </section>

          {/* ====== 📊 进行中评审 ====== */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <ClipboardCheck size={15} strokeWidth={1.8} className="text-[var(--accent-strong)]" />
              <h3 className="text-sm font-bold text-[var(--foreground)]">进行中评审</h3>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums text-white" style={{ background: inProgress.length > 0 ? 'var(--accent)' : 'var(--muted-foreground)' }}>
                {inProgress.length}
              </span>
            </div>

            {inProgress.length === 0 ? (
              <div className="neu-card-static rounded-2xl px-6 py-8 text-center">
                <ClipboardCheck size={24} strokeWidth={1.2} className="mx-auto mb-2 text-[var(--muted-foreground)] opacity-50" />
                <p className="text-xs text-[var(--muted-foreground)]">暂无进行中评审项目</p>
              </div>
            ) : (
              <div className="space-y-2">
                {inProgress.map(p => {
                  const sc = STAGE_COLOR[p.project.stage as keyof typeof STAGE_COLOR] ?? '#7c3aed';
                  const done = p.progress >= 100;
                  return (
                    <div key={p.id} className="neu-card-static rounded-xl p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-sm font-bold text-[var(--foreground)]">{p.project.name}</span>
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in oklch, ${sc} 12%, transparent)`, color: sc }}>
                            {STAGE_LABEL[p.project.stage as keyof typeof STAGE_LABEL] ?? p.project.stage}
                          </span>
                        </div>
                        <button onClick={() => router.push(`/evaluate/${p.project.id}`)}
                          className="neu-btn-soft !h-[28px] !text-xs shrink-0">
                          {done ? '查看' : '继续评审'} <ChevronRight size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="exp-bar flex-1">
                          <i style={{ width: `${p.progress}%`, '--bar': done ? 'var(--success)' : sc } as React.CSSProperties} />
                        </div>
                        <span className={`w-11 text-right text-sm font-bold tabular-nums ${done ? 'text-[var(--success)]' : 'text-[var(--accent-strong)]'}`}>
                          {p.progress}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ====== 📋 最近完成 ====== */}
          {completed.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 size={15} strokeWidth={1.8} className="text-[var(--success)]" />
                <h3 className="text-sm font-bold text-[var(--foreground)]">最近完成</h3>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums text-white" style={{ background: 'var(--success)' }}>
                  {completed.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {completed.map(p => (
                  <div key={p.id} className="neu-card-static rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="truncate text-xs font-semibold text-[var(--foreground)]">{p.project.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[11px] text-[var(--muted-foreground)]">
                      总分 {Number(p.totalScore).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ── 子组件 ── */

function TaskGroup({ icon, color, label, count, children }: {
  icon: React.ReactNode; color: string; label: string; count: number; children: React.ReactNode;
}) {
  return (
    <div className="neu-card-static rounded-xl p-4">
      <div className="mb-2 flex items-center gap-2" style={{ color }}>
        {icon}
        <span className="text-xs font-bold">{label}</span>
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white" style={{ background: color }}>
          {count}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function TaskRow({ name, stage, subtitle, meta, onClick }: {
  name: string; stage?: string; subtitle?: string; meta?: string; onClick: () => void;
}) {
  const sc = stage ? STAGE_COLOR[stage as keyof typeof STAGE_COLOR] : undefined;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]">
      <span className="truncate text-xs font-semibold text-[var(--foreground)]">{name}</span>
      {stage && sc && (
        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: `color-mix(in oklch, ${sc} 12%, transparent)`, color: sc }}>
          {STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage}
        </span>
      )}
      {subtitle && <span className="truncate text-[11px] text-[var(--muted-foreground)]">· {subtitle}</span>}
      {meta && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]">{meta}</span>}
      <ChevronRight size={12} className="shrink-0 text-[var(--muted-foreground)]" />
    </button>
  );
}
