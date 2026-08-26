'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, Plus, Send, Trash2, UserPlus, Users } from 'lucide-react';
import {
  addTeamMember,
  createPlan,
  deletePlan,
  fetchPlanUsers,
  fetchPlans,
  fetchTeam,
  removeTeamMember,
  reviewPlans,
  submitPlans,
  type PlanStatus,
  type ProjectPlanRow,
  type ProjectTeamRow,
} from '@/lib/api/project-plan';

const STATUS_CHIP: Record<PlanStatus, { label: string; cls: string }> = {
  DRAFT: { label: '草稿', cls: 'bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] text-[color:var(--muted-foreground)]' },
  SUBMITTED: { label: '待审核', cls: 'bg-[color-mix(in_oklch,oklch(0.75_0.14_75)_20%,transparent)] text-[oklch(0.5_0.12_75)]' },
  APPROVED: { label: '已通过', cls: 'bg-[color-mix(in_oklch,oklch(0.72_0.14_155)_18%,transparent)] text-[oklch(0.48_0.12_155)]' },
  REJECTED: { label: '已驳回', cls: 'bg-[color-mix(in_oklch,oklch(0.65_0.17_25)_16%,transparent)] text-[oklch(0.5_0.16_25)]' },
};

const TEAM_ROLES = ['负责人', '技术', '商务', '监督', '其他'];

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('zh-CN') : '');

/** CTS-EBS01 A-47~49：任务计划（整包报审）+ 项目团队，嵌入项目详情 hero 之下 */
export function ProjectPlanSection({
  itemId,
  canModify,
  currentUserRole,
}: {
  itemId: string;
  canModify: boolean;
  currentUserRole?: string;
}) {
  const [plans, setPlans] = useState<ProjectPlanRow[]>([]);
  const [team, setTeam] = useState<ProjectTeamRow[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  // 团队新增
  const [teamUserId, setTeamUserId] = useState('');
  const [teamRole, setTeamRole] = useState('负责人');
  const [teamDuty, setTeamDuty] = useState('');

  const reload = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([fetchPlans(itemId), fetchTeam(itemId)]);
      setPlans(p);
      setTeam(t);
    } catch (e) {
      // 静默：面板初次渲染失败不打断详情页
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    fetchPlanUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const hasPending = plans.some((p) => p.status === 'SUBMITTED');
  const hasEditable = plans.some((p) => p.status === 'DRAFT' || p.status === 'REJECTED');
  const lastComment = [...plans].reverse().find((p) => p.reviewComment)?.reviewComment ?? null;

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const addPlan = () => {
    if (!newContent.trim()) return;
    void run(async () => {
      await createPlan(itemId, { content: newContent.trim(), ownerUserId: newOwner || undefined });
      setNewContent('');
    }, '已添加计划条目');
  };

  return (
    <div className="px-5 pb-5">
      <div className="wb-panel px-5 py-4">
        {/* ── 标题行 ── */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
            <ClipboardList size={15} className="text-[color:var(--accent)]" />
            任务计划与团队
            <span className="text-[10px] font-normal text-[color:var(--muted-foreground)]">CTS A-47~49</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canModify && hasEditable && (
              <button type="button" className="neu-btn-xs" disabled={busy} onClick={() => void run(() => submitPlans(itemId), '计划已报审，等待受理')}>
                <Send size={13} />报审计划
              </button>
            )}
            {currentUserRole === 'admin' && hasPending && (
              <>
                <button type="button" className="neu-btn-xs" disabled={busy} onClick={() => void run(() => reviewPlans(itemId, { approve: true }), '计划已审核通过')}>
                  <CheckCircle2 size={13} />审核通过
                </button>
                <button type="button" className="neu-btn-xs is-danger" disabled={busy} onClick={() => setRejectOpen((v) => !v)}>
                  <AlertTriangle size={13} />驳回
                </button>
              </>
            )}
          </div>
        </div>

        {rejectOpen && currentUserRole === 'admin' && hasPending && (
          <div className="mt-3 flex items-start gap-2">
            <textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="驳回理由（必填）"
              className="neu-input min-h-[56px] flex-1 resize-none text-sm"
            />
            <button
              type="button"
              className="neu-btn-xs is-danger shrink-0"
              disabled={busy || !rejectComment.trim()}
              onClick={() =>
                void run(async () => {
                  await reviewPlans(itemId, { approve: false, comment: rejectComment.trim() });
                  setRejectOpen(false);
                  setRejectComment('');
                }, '已驳回，条目可修改后重新报审')
              }
            >
              确认驳回
            </button>
          </div>
        )}

        {lastComment && (
          <p className="mt-2 text-xs text-[oklch(0.5_0.16_25)]">最近审核意见：{lastComment}</p>
        )}

        {loading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
            <Loader2 size={13} className="animate-spin" />加载中…
          </div>
        ) : (
          <>
            {/* ── 计划条目 ── */}
            {plans.length === 0 ? (
              <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">暂无计划条目。添加工作内容与责任人后整包报审，审核通过计划生效。</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {plans.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-[10px] bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] px-3 py-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CHIP[p.status].cls}`}>{STATUS_CHIP[p.status].label}</span>
                    <span className="min-w-0 flex-1 truncate text-[color:var(--foreground)]">{p.content}</span>
                    <span className="shrink-0 text-[color:var(--muted-foreground)]">{p.ownerName ?? '未指定责任人'}</span>
                    {(p.startDate || p.endDate) && (
                      <span className="shrink-0 font-mono text-[10px] text-[color:var(--muted-foreground)]">{fmtDate(p.startDate)}~{fmtDate(p.endDate)}</span>
                    )}
                    {canModify && (p.status === 'DRAFT' || p.status === 'REJECTED') && (
                      <button
                        type="button"
                        className="text-[color:var(--muted-foreground)] transition-colors hover:text-rose-500"
                        disabled={busy}
                        onClick={() => void run(() => deletePlan(itemId, p.id), '已删除')}
                        aria-label="删除条目"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canModify && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPlan()}
                  placeholder="新增工作内容，如：编制采购文件"
                  className="neu-input h-8 min-w-[180px] flex-1 text-xs"
                />
                <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="neu-input h-8 text-xs">
                  <option value="">责任人（可选）</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                  ))}
                </select>
                <button type="button" className="neu-btn-xs" disabled={busy || !newContent.trim()} onClick={addPlan}>
                  <Plus size={13} />添加
                </button>
              </div>
            )}

            {/* ── 团队 ── */}
            <div className="mt-4 flex items-center gap-2 text-[12px] font-semibold text-[color:var(--foreground)]">
              <Users size={14} className="text-[color:var(--accent)]" />
              项目团队
            </div>
            {team.length === 0 ? (
              <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">暂未设置团队分工。</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {team.map((m) => (
                  <li key={m.id} className="flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-3 py-1 text-[11px]">
                    <span className="font-semibold text-[color:var(--accent)]">{m.role}</span>
                    <span className="text-[color:var(--foreground)]">{m.memberName}</span>
                    {m.duty && <span className="text-[color:var(--muted-foreground)]">· {m.duty}</span>}
                    {canModify && (
                      <button
                        type="button"
                        className="text-[color:var(--muted-foreground)] hover:text-rose-500"
                        disabled={busy}
                        onClick={() => void run(() => removeTeamMember(itemId, m.id), '已移除成员')}
                        aria-label="移除成员"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canModify && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select value={teamUserId} onChange={(e) => setTeamUserId(e.target.value)} className="neu-input h-8 text-xs">
                  <option value="">选择成员</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                  ))}
                </select>
                <select value={teamRole} onChange={(e) => setTeamRole(e.target.value)} className="neu-input h-8 text-xs">
                  {TEAM_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <input
                  value={teamDuty}
                  onChange={(e) => setTeamDuty(e.target.value)}
                  placeholder="职责（可选）"
                  className="neu-input h-8 min-w-[120px] flex-1 text-xs"
                />
                <button
                  type="button"
                  className="neu-btn-xs"
                  disabled={busy || !teamUserId}
                  onClick={() =>
                    void run(async () => {
                      await addTeamMember(itemId, { userId: teamUserId, role: teamRole, duty: teamDuty.trim() || undefined });
                      setTeamUserId('');
                      setTeamDuty('');
                    }, '已添加成员')
                  }
                >
                  <UserPlus size={13} />添加成员
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
