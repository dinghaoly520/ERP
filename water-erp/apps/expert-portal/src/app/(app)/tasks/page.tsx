'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ListTodo, Gavel, AlertTriangle, CheckCircle2, XCircle, ChevronRight, RefreshCw, Plus, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';

interface MotionItem {
  id: string;
  projectId: string;
  projectName: string;
  projectStage: string;
  title: string;
  description?: string | null;
  status: string;
  result?: string | null;
  createdBy: string;
  myVote: string | null;
  votes: Array<{ expertId: string; vote: string }>;
}

interface DisputeItem {
  id: string;
  projectId: string;
  projectName: string;
  projectStage: string;
  type: string;
  title: string;
  content: string;
  status: string;
  response?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

interface ProjectEntry {
  projectId: string;
  projectName: string;
  stage: string;
  myExpertId: string;
  isLead: boolean;
}

interface MyTasks {
  projects: ProjectEntry[];
  motions: MotionItem[];
  disputes: DisputeItem[];
}

const TYPE_LABEL: Record<string, string> = {
  scoring: '评分异议',
  procedure: '程序异议',
  other: '其他',
};

const VOTE_LABEL: Record<string, string> = {
  approve: '赞成',
  reject: '反对',
  abstain: '弃权',
};

export default function ExpertTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<MyTasks | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<MyTasks>('/expert/tasks')
      .then(setTasks)
      .catch((e) => toast.error(`加载待办失败: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleVote(motionId: string, vote: string) {
    setBusy(true);
    try {
      await api.post(`/expert/motions/${motionId}/vote`, { vote });
      toast.success('投票成功');
      load();
    } catch (e: any) {
      toast.error(e.message || '投票失败');
    } finally {
      setBusy(false);
    }
  }

  const motions = tasks?.motions ?? [];
  const disputes = tasks?.disputes ?? [];
  const projects = tasks?.projects ?? [];
  const projectOpts = projects.map(p => ({ value: p.projectId, label: p.projectName, stage: p.stage }));
  const isLeadAnywhere = projects.some(p => p.isLead);

  // ── 发起表决 ──
  const [showMotionForm, setShowMotionForm] = useState(false);
  const [motionForm, setMotionForm] = useState({ projectId: '', title: '', description: '' });

  async function handleCreateMotion() {
    if (!motionForm.projectId || !motionForm.title.trim()) {
      toast.error('请选择项目并填写表决标题');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/expert/projects/${motionForm.projectId}/motions`, { title: motionForm.title, description: motionForm.description, type: 'other' });
      setMotionForm({ projectId: '', title: '', description: '' });
      setShowMotionForm(false);
      toast.success('表决已发起');
      load();
    } catch (e: any) {
      toast.error(e.message || '发起失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseMotion(motionId: string) {
    setBusy(true);
    try {
      await api.post(`/expert/motions/${motionId}/close`, {});
      toast.success('决议已生成');
      load();
    } catch (e: any) {
      toast.error(e.message || '关闭失败');
    } finally {
      setBusy(false);
    }
  }

  // ── 提交异议 ──
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeForm, setDisputeForm] = useState({ projectId: '', title: '', content: '' });

  async function handleDisputeSubmit() {
    if (!disputeForm.projectId || !disputeForm.title.trim() || !disputeForm.content.trim()) {
      toast.error('请选择项目并填写异议标题和内容');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/expert/projects/${disputeForm.projectId}/disputes`, { title: disputeForm.title, content: disputeForm.content, type: 'scoring' });
      setDisputeForm({ projectId: '', title: '', content: '' });
      setShowDisputeForm(false);
      toast.success('异议已提交');
      load();
    } catch (e: any) {
      toast.error(e.message || '提交失败');
    } finally {
      setBusy(false);
    }
  }

  // 自动选项目（只有一个项目时）
  const autoFillProject = (setForm: React.Dispatch<React.SetStateAction<any>>) => {
    if (projects.length === 1) {
      setForm((prev: any) => {
        if (prev.projectId) return prev;
        return { ...prev, projectId: projects[0].projectId };
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* 页面标题 */}
      <div className="page-hero">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
            >
              <ListTodo size={16} strokeWidth={1.8} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-[-0.02em] text-[var(--foreground)]">评审待办</h2>
              <p className="text-xs text-[var(--muted-foreground)]">跨项目表决投票与异议工单</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(motions.length > 0 || disputes.length > 0) && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums text-white" style={{ background: 'var(--accent)' }}>
                {motions.length + disputes.length} 项
              </span>
            )}
            <button onClick={load} disabled={loading} className="neu-btn-soft !h-[30px] !w-[30px] !p-0" title="刷新">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="neu-card-static rounded-2xl px-6 py-12 text-center">
          <ListTodo size={28} strokeWidth={1.2} className="mx-auto mb-3 animate-pulse text-[var(--muted-foreground)]" />
          <p className="text-xs text-[var(--muted-foreground)]">加载待办数据…</p>
        </div>
      ) : (
        <>
          {/* ====== 表决记录（投票中 + 已决议）====== */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gavel size={15} strokeWidth={1.8} className="text-[var(--accent)]" />
                <h3 className="text-sm font-bold text-[var(--foreground)]">表决记录</h3>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums text-white" style={{ background: motions.length > 0 ? 'var(--warning)' : 'var(--muted-foreground)' }}>
                  {motions.length}
                </span>
              </div>
              {isLeadAnywhere && (
                <button
                  onClick={() => { autoFillProject(setMotionForm); setShowMotionForm(!showMotionForm); }}
                  className="neu-btn-soft !h-[28px] !text-xs"
                >
                  <Plus size={12} /> {showMotionForm ? '取消' : '发起表决'}
                </button>
              )}
            </div>

            {showMotionForm && (
              <div className="neu-card-static mb-3 rounded-xl p-4 space-y-3">
                {projects.length > 1 && (
                  <select
                    className="workbench-input w-full"
                    value={motionForm.projectId}
                    onChange={e => setMotionForm(p => ({ ...p, projectId: e.target.value }))}
                  >
                    <option value="" disabled>选择项目</option>
                    {projects.map(p => (
                      <option key={p.projectId} value={p.projectId}>{p.projectName} · {STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL] ?? p.stage}</option>
                    ))}
                  </select>
                )}
                <input className="workbench-input w-full" placeholder="表决标题" value={motionForm.title}
                  onChange={e => setMotionForm(p => ({ ...p, title: e.target.value }))} />
                <textarea className="workbench-input w-full !min-h-[48px]" placeholder="表决说明（选填）" value={motionForm.description}
                  onChange={e => setMotionForm(p => ({ ...p, description: e.target.value }))} />
                <button onClick={handleCreateMotion} disabled={busy || !motionForm.title.trim()}
                  className="neu-btn-primary !h-[32px] !text-xs">{busy ? '发起中…' : '发起表决'}</button>
              </div>
            )}

            {motions.length === 0 ? (
              <div className="neu-card-static rounded-2xl px-6 py-10 text-center">
                <Gavel size={24} strokeWidth={1.2} className="mx-auto mb-2 text-[var(--muted-foreground)] opacity-50" />
                <p className="text-xs text-[var(--muted-foreground)]">暂无表决记录</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)] opacity-60">点击「发起表决」按钮新建</p>
              </div>
            ) : (
              <div className="space-y-2">
                {motions.map((m) => {
                  const approves = m.votes.filter((v: any) => v.vote === 'approve').length;
                  const rejects = m.votes.filter((v: any) => v.vote === 'reject').length;
                  const totalVotes = m.votes.length;
                  const isVoting = m.status === 'voting';
                  const resultMeta = isVoting
                    ? { label: '投票中', color: 'var(--warning)' }
                    : m.result === 'approved'
                      ? { label: '✓ 通过', color: 'var(--success)' }
                      : m.result === 'rejected'
                        ? { label: '✗ 否决', color: 'var(--danger)' }
                        : { label: '△ 平票', color: 'var(--muted-foreground)' };
                  return (
                    <div key={m.id} className="neu-card-static rounded-xl p-4">
                      {/* 项目行 */}
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/evaluate/${m.projectId}`)}
                          className="text-[11px] font-bold text-[var(--accent)] hover:underline"
                        >
                          {m.projectName}
                        </button>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: `color-mix(in oklch, ${STAGE_COLOR[m.projectStage as keyof typeof STAGE_COLOR] ?? '#7c3aed'} 12%, transparent)`, color: STAGE_COLOR[m.projectStage as keyof typeof STAGE_COLOR] ?? '#7c3aed' }}
                        >
                          {STAGE_LABEL[m.projectStage as keyof typeof STAGE_LABEL] ?? m.projectStage}
                        </span>
                        <ChevronRight size={12} className="ml-auto text-[var(--muted-foreground)]" />
                      </div>

                      {/* 表决内容 */}
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <span className="text-sm font-bold text-[var(--foreground)]">{m.title}</span>
                          <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in oklch, ${resultMeta.color} 14%, transparent)`, color: resultMeta.color }}>
                            {resultMeta.label}
                          </span>
                        </div>
                      </div>
                      {m.description && (
                        <p className="mb-2 text-xs leading-5 text-[var(--muted-foreground)]">{m.description}</p>
                      )}

                      {/* 票数 + 投票 */}
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="tabular-nums text-[var(--success)]">赞成 {approves}</span>
                        <span className="tabular-nums text-[var(--danger)]">反对 {rejects}</span>
                        <span className="tabular-nums text-[var(--muted-foreground)]">/ {totalVotes}</span>

                        {m.myVote ? (
                          <span className="ml-auto rounded px-2 py-1 text-xs font-semibold" style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
                            已投：{VOTE_LABEL[m.myVote] ?? m.myVote}
                          </span>
                        ) : isVoting ? (
                          <div className="ml-auto flex gap-1.5">
                            <button onClick={() => handleVote(m.id, 'approve')} disabled={busy}
                              className="neu-btn-soft !h-[28px] !text-xs !text-[var(--success)]">赞成</button>
                            <button onClick={() => handleVote(m.id, 'reject')} disabled={busy}
                              className="neu-btn-soft !h-[28px] !text-xs !text-[var(--danger)]">反对</button>
                            <button onClick={() => handleVote(m.id, 'abstain')} disabled={busy}
                              className="neu-btn-soft !h-[28px] !text-xs">弃权</button>
                          </div>
                        ) : null}
                      </div>
                      {/* 关闭投票（组长或表决发起人） */}
                      {(() => {
                        const proj = projects.find(p => p.projectId === m.projectId);
                        const canClose = isVoting && (proj?.isLead || proj?.myExpertId === m.createdBy);
                        return canClose ? (
                          <div className="mt-2">
                            <button onClick={() => handleCloseMotion(m.id)} disabled={busy}
                              className="neu-btn-soft is-warning !h-[28px] !text-xs">结束投票·形成决议</button>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ====== 我的异议工单 ====== */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} strokeWidth={1.8} className="text-[var(--warning)]" />
                <h3 className="text-sm font-bold text-[var(--foreground)]">我的异议工单</h3>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums text-white" style={{ background: disputes.length > 0 ? 'var(--warning)' : 'var(--muted-foreground)' }}>
                  {disputes.length}
                </span>
              </div>
              {isLeadAnywhere && (
                <button
                  onClick={() => { autoFillProject(setDisputeForm); setShowDisputeForm(!showDisputeForm); }}
                  className="neu-btn-soft !h-[28px] !text-xs"
                >
                  <Plus size={12} /> {showDisputeForm ? '取消' : '提交异议'}
                </button>
              )}
            </div>

            {showDisputeForm && (
              <div className="neu-card-static mb-3 rounded-xl p-4 space-y-3">
                {projects.length > 1 && (
                  <select
                    className="workbench-input w-full"
                    value={disputeForm.projectId}
                    onChange={e => setDisputeForm(p => ({ ...p, projectId: e.target.value }))}
                  >
                    <option value="" disabled>选择项目</option>
                    {projects.map(p => (
                      <option key={p.projectId} value={p.projectId}>{p.projectName} · {STAGE_LABEL[p.stage as keyof typeof STAGE_LABEL] ?? p.stage}</option>
                    ))}
                  </select>
                )}
                <input className="workbench-input w-full" placeholder="异议标题" value={disputeForm.title}
                  onChange={e => setDisputeForm(p => ({ ...p, title: e.target.value }))} />
                <textarea className="workbench-input w-full !min-h-[64px]" placeholder="异议详细内容" value={disputeForm.content}
                  onChange={e => setDisputeForm(p => ({ ...p, content: e.target.value }))} />
                <button onClick={handleDisputeSubmit} disabled={busy || !disputeForm.title.trim() || !disputeForm.content.trim()}
                  className="neu-btn-primary !h-[32px] !text-xs">{busy ? '提交中…' : '提交异议工单'}</button>
              </div>
            )}

            {disputes.length === 0 ? (
              <div className="neu-card-static rounded-2xl px-6 py-10 text-center">
                <AlertTriangle size={24} strokeWidth={1.2} className="mx-auto mb-2 text-[var(--muted-foreground)] opacity-50" />
                <p className="text-xs text-[var(--muted-foreground)]">暂无异议工单</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)] opacity-60">点击「提交异议」按钮新建</p>
              </div>
            ) : (
              <div className="space-y-2">
                {disputes.map((d) => {
                  const isOpen = d.status === 'open';
                  const isResolved = d.status === 'resolved';
                  const StatusIcon = isOpen ? AlertTriangle : isResolved ? CheckCircle2 : XCircle;
                  const statusColor = isOpen ? 'var(--warning)' : isResolved ? 'var(--success)' : 'var(--danger)';
                  const statusLabel = isOpen ? '待裁决' : isResolved ? '已采纳' : '已驳回';
                  return (
                    <div key={d.id} className="neu-card-static rounded-xl p-4">
                      {/* 项目行 */}
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/evaluate/${d.projectId}`)}
                          className="text-[11px] font-bold text-[var(--accent)] hover:underline"
                        >
                          {d.projectName}
                        </button>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: `color-mix(in oklch, ${STAGE_COLOR[d.projectStage as keyof typeof STAGE_COLOR] ?? '#7c3aed'} 12%, transparent)`, color: STAGE_COLOR[d.projectStage as keyof typeof STAGE_COLOR] ?? '#7c3aed' }}
                        >
                          {STAGE_LABEL[d.projectStage as keyof typeof STAGE_LABEL] ?? d.projectStage}
                        </span>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent)' }}
                        >
                          {TYPE_LABEL[d.type] ?? d.type}
                        </span>
                        <span
                          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ background: `color-mix(in oklch, ${statusColor} 12%, transparent)`, color: statusColor }}
                        >
                          <StatusIcon size={11} strokeWidth={2} />
                          {statusLabel}
                        </span>
                      </div>

                      <p className="text-sm font-bold text-[var(--foreground)]">{d.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">{d.content}</p>

                      {d.response && (
                        <div className="mt-2 rounded-[10px] px-3 py-2" style={{ background: 'oklch(0.975 0.012 258 / 0.5)', border: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                          <p className="text-[10px] font-semibold text-[var(--muted-foreground)]">
                            {isResolved ? '采纳回复' : '驳回理由'} · {new Date(d.resolvedAt!).toLocaleString('zh-CN')}
                          </p>
                          <p className="mt-0.5 text-xs leading-5 text-[var(--foreground)]">{d.response}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
