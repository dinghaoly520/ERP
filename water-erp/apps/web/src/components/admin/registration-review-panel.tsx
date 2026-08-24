"use client";

import {
  Check,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  approveRegistration,
  fetchPendingRegistrations,
  fetchRegistrationReviews,
  rejectRegistration,
  type PendingRegistration,
  type RegistrationReview,
} from "@/lib/api/auth";
import { Modal } from "@/components/workbench";

const ROLE_LABEL: Record<string, string> = {
  management: "管理权限",
  office: "办公权限",
};

/** 状态 pill —— 语义色轻底（color-mix 从 CSS 变量派生，不写死 rgba） */
function Pill({ tone, children }: { tone: "accent" | "success" | "danger"; children: React.ReactNode }) {
  const tones = {
    accent: "bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]",
    success: "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-[var(--success)]",
    danger: "bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-[var(--danger)]",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  variant = "primary",
  showReasonInput = false,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "primary" | "danger";
  showReasonInput?: boolean;
  pending: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={pending} className="neu-btn-soft">
            取消
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(reason.trim() || undefined)}
            className={`neu-btn-primary ${variant === "danger" ? "is-danger" : ""}`}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {showReasonInput && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="请输入拒绝理由（必填）"
          rows={3}
          className="neu-input w-full resize-none text-sm"
        />
      )}
    </Modal>
  );
}

/** 申请人识别块：头像字 + 姓名/用户名 + 公司·部门 */
function Applicant({
  displayName,
  username,
  company,
  department,
}: {
  displayName: string;
  username: string;
  company?: string | null;
  department?: string | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="neu-icon-well inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-sm font-semibold text-[var(--accent)]">
        {(displayName || username).charAt(0)}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--foreground)]">
          {displayName}
          <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">{username}</span>
        </div>
        <div className="truncate text-xs text-[var(--muted-foreground)]">
          {company}
          {department ? ` · ${department}` : ""}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="neu-icon-well mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] text-[var(--muted-foreground)]">
        {icon}
      </span>
      <div className="text-sm font-medium text-[var(--foreground)]">{title}</div>
      {hint ? <div className="mt-1 text-sm text-[var(--muted-foreground)]">{hint}</div> : null}
    </div>
  );
}

export function RegistrationReviewPanel({
  onAccountsChanged,
}: {
  /** 审核动作改变了账号集合（通过=新增激活账号 / 拒绝=删除账号），通知父级即时刷新账号列表 */
  onAccountsChanged?: () => void;
}) {
  const [pending, setPending] = useState<PendingRegistration[]>([]);
  const [reviews, setReviews] = useState<RegistrationReview[]>([]);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { type: "approve"; id: string }
    | { type: "reject"; id: string }
    | null
  >(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        fetchPendingRegistrations(),
        fetchRegistrationReviews(),
      ]);
      setPending(p);
      setReviews(h);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "加载审核数据失败");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const handleRefresh = () => {
    setActionMessage(null);
    startTransition(async () => {
      await load();
    });
  };

  const handleApprove = (id: string) => {
    setActionMessage(null);
    startTransition(async () => {
      try {
        await approveRegistration(id);
        setActionMessage("已通过注册申请");
        await load();
        onAccountsChanged?.();
      } catch (e) {
        setActionMessage(e instanceof Error ? e.message : "审批失败");
      }
      setConfirm(null);
    });
  };

  const handleReject = (id: string, reason?: string) => {
    if (!reason) {
      setActionMessage("拒绝时必须填写理由");
      return;
    }
    setActionMessage(null);
    startTransition(async () => {
      try {
        await rejectRegistration(id, reason);
        setActionMessage("已拒绝注册申请");
        await load();
        onAccountsChanged?.();
      } catch (e) {
        setActionMessage(e instanceof Error ? e.message : "拒绝失败");
      }
      setConfirm(null);
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="inline-flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />
          正在加载审核数据...
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="rounded-[16px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-5 py-4 text-sm text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
        {errorMessage}
      </div>
    );
  }

  const confirmConfig = confirm
    ? confirm.type === "approve"
      ? {
          title: "确认通过注册申请",
          description: "通过后该用户将被激活并按其申请权限分配角色。",
          confirmLabel: "确认通过",
          variant: "primary" as const,
          showReason: false,
          onConfirm: () => handleApprove(confirm.id),
        }
      : {
          title: "拒绝注册申请",
          description: "拒绝后该用户账号将被删除。请填写拒绝理由。",
          confirmLabel: "确认拒绝",
          variant: "danger" as const,
          showReason: true,
          onConfirm: (reason?: string) => handleReject(confirm.id, reason),
        }
    : null;

  return (
    <div className="space-y-4">
      {confirmConfig && (
        <ConfirmDialog
          open
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant}
          showReasonInput={confirmConfig.showReason}
          pending={isPending}
          onConfirm={confirmConfig.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* 工具条：统计 + 内层 tab + 刷新 */}
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
        <div className="neu-tab-bar">
          <button type="button" className={`neu-tab ${tab === "pending" ? "is-active" : ""}`} onClick={() => setTab("pending")}>
            <UserPlus size={13} strokeWidth={1.9} />
            待审核
            <span className="neu-tab-count">{pending.length}</span>
          </button>
          <button type="button" className={`neu-tab ${tab === "history" ? "is-active" : ""}`} onClick={() => setTab("history")}>
            <History size={13} strokeWidth={1.9} />
            审核历史
            <span className="neu-tab-count">{reviews.length}</span>
          </button>
        </div>
        <button type="button" onClick={handleRefresh} disabled={isPending} className="neu-btn-xs" aria-label="刷新">
          <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
        </button>
      </div>

      {actionMessage && (
        <div className="rounded-[14px] bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.55)]">
          {actionMessage}
        </div>
      )}

      {/* 待审核表格 */}
      {tab === "pending" &&
        (pending.length === 0 ? (
          <div className="neu-table-card">
            <EmptyState
              icon={<ShieldCheck size={20} strokeWidth={1.6} />}
              title="当前没有待审核的注册申请"
              hint="新注册会出现在此处"
            />
          </div>
        ) : (
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th>申请人</th>
                    <th>申请权限</th>
                    <th>联系方式</th>
                    <th>办公位置</th>
                    <th>申请时间</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Applicant displayName={u.displayName} username={u.username} company={u.company} department={u.departmentName} />
                      </td>
                      <td>
                        <Pill tone="accent">{u.requestedRole ? ROLE_LABEL[u.requestedRole] : "—"}</Pill>
                      </td>
                      <td>
                        <div className="text-sm text-[var(--foreground)]">{u.phone}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{u.email ?? "—"}</div>
                      </td>
                      <td className="text-sm text-[var(--muted-foreground)]">{u.officeLocation ?? "—"}</td>
                      <td className="text-sm tabular-nums text-[var(--muted-foreground)]">
                        {new Date(u.createdAt).toLocaleString("zh-CN")}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirm({ type: "reject", id: u.id })}
                            className="neu-btn-xs is-danger"
                          >
                            <X size={12} strokeWidth={2} />
                            拒绝
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirm({ type: "approve", id: u.id })}
                            className="neu-btn-xs is-success"
                          >
                            <Check size={12} strokeWidth={2.2} />
                            通过
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* 审核历史表格 */}
      {tab === "history" &&
        (reviews.length === 0 ? (
          <div className="neu-table-card">
            <EmptyState icon={<History size={20} strokeWidth={1.6} />} title="暂无审核记录" />
          </div>
        ) : (
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th>申请人</th>
                    <th>申请权限</th>
                    <th>审核结果</th>
                    <th>审核人</th>
                    <th>审核时间</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Applicant displayName={r.displayName} username={r.username} company={r.company} department={r.department} />
                      </td>
                      <td className="text-sm text-[var(--muted-foreground)]">
                        {r.requestedRole ? ROLE_LABEL[r.requestedRole] : "—"}
                      </td>
                      <td>
                        <Pill tone={r.decision === "APPROVED" ? "success" : "danger"}>
                          {r.decision === "APPROVED" ? "已通过" : "已拒绝"}
                        </Pill>
                      </td>
                      <td className="text-sm text-[var(--foreground)]">{r.reviewedByName ?? "—"}</td>
                      <td className="text-sm tabular-nums text-[var(--muted-foreground)]">
                        {new Date(r.reviewedAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="max-w-[16rem] truncate text-sm text-[var(--muted-foreground)]" title={r.decisionNote ?? undefined}>
                        {r.decisionNote ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}
