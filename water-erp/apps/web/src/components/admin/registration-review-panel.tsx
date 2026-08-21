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

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[12px] bg-white/50 px-3.5 py-2 text-sm">
      <span className="shrink-0 text-[var(--muted-foreground)]">{label}</span>
      <span className="min-w-0 break-all text-right font-medium text-[var(--foreground)]">
        {value || "—"}
      </span>
    </div>
  );
}

export function RegistrationReviewPanel() {
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
      <div className="rounded-[20px] border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-5 py-4 text-sm text-[var(--danger)]">
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
    <div className="space-y-5">
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

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="command-orb inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/76 bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(238,244,255,0.82))] text-[var(--accent)] shadow-[0_10px_22px_rgba(72,120,235,0.08)]">
            <ShieldCheck size={18} strokeWidth={1.9} />
          </span>
          <div>
            <div className="text-[0.96rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
              注册审核管理
            </div>
            <div className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              {pending.length} 条待审核 &middot; {reviews.length} 条审核历史
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-white/60 bg-white/62 px-3.5 text-sm font-medium text-[var(--muted-foreground)] transition hover:bg-white/80 hover:text-[var(--foreground)] disabled:opacity-50"
        >
          <RefreshCw size={14} strokeWidth={1.9} className={isPending ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {actionMessage && (
        <div className="rounded-[16px] border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[var(--foreground)]">
          {actionMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-[12px] bg-white/50 p-1">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[9px] px-4 py-2 text-sm font-medium transition ${
            tab === "pending"
              ? "bg-white text-[var(--foreground)] shadow-[0_2px_8px_rgba(59,89,143,0.08)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          <UserPlus size={14} strokeWidth={1.9} />
          待审核
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[9px] px-4 py-2 text-sm font-medium transition ${
            tab === "history"
              ? "bg-white text-[var(--foreground)] shadow-[0_2px_8px_rgba(59,89,143,0.08)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          <History size={14} strokeWidth={1.9} />
          审核历史
        </button>
      </div>

      {/* Pending tab */}
      {tab === "pending" &&
        (pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[20px] border border-white/55 bg-white/52 py-16 text-center">
            <span className="command-orb mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(241,245,251,0.88))] text-[var(--muted-foreground)]">
              <ShieldCheck size={20} strokeWidth={1.6} />
            </span>
            <div className="text-sm font-medium text-[var(--foreground)]">当前没有待审核的注册申请</div>
            <div className="mt-1 text-sm text-[var(--muted-foreground)]">新注册会出现在此处</div>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((u) => (
              <div
                key={u.id}
                className="rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.72))] px-4 py-3.5 shadow-[0_12px_28px_rgba(59,89,143,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/70 bg-white/74 text-sm font-semibold text-[var(--accent)]">
                      {(u.displayName || u.username).charAt(0)}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-[var(--foreground)]">
                        {u.displayName}
                        <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                          {u.username}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)]">
                        {u.company}
                        {u.departmentName ? ` · ${u.departmentName}` : ""}
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(122,168,255,0.12)] px-2.5 py-1 text-[11px] font-semibold leading-none text-[var(--accent)]">
                    {u.requestedRole ? ROLE_LABEL[u.requestedRole] : "—"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Detail label="手机号" value={u.phone} />
                  <Detail label="邮箱" value={u.email} />
                  <Detail label="办公位置" value={u.officeLocation} />
                  <Detail label="申请时间" value={new Date(u.createdAt).toLocaleString("zh-CN")} />
                </div>

                <div className="mt-3 flex gap-2.5">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setConfirm({ type: "reject", id: u.id })}
                    className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[rgba(215,89,89,0.16)] bg-[rgba(255,243,243,0.84)] px-3.5 py-2.5 text-sm font-medium text-[var(--danger)] transition hover:bg-[rgba(255,230,230,0.9)] disabled:opacity-60"
                  >
                    <X size={14} strokeWidth={2} />
                    拒绝
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setConfirm({ type: "approve", id: u.id })}
                    className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--accent)] bg-[var(--accent)] px-3.5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                  >
                    <Check size={14} strokeWidth={2.2} />
                    通过
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* History tab */}
      {tab === "history" &&
        (reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[20px] border border-white/55 bg-white/52 py-16 text-center">
            <History size={22} strokeWidth={1.6} className="mb-3 text-[var(--muted-foreground)]" />
            <div className="text-sm font-medium text-[var(--foreground)]">暂无审核记录</div>
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.72))] px-4 py-3.5 shadow-[0_12px_28px_rgba(59,89,143,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/70 bg-white/74 text-sm font-semibold text-[var(--accent)]">
                      {(r.displayName || r.username).charAt(0)}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-[var(--foreground)]">
                        {r.displayName}
                        <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                          {r.username}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)]">
                        {r.company}
                        {r.department ? ` · ${r.department}` : ""}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${
                      r.decision === "APPROVED"
                        ? "bg-[rgba(92,181,150,0.12)] text-[rgba(42,140,110,0.92)]"
                        : "bg-[rgba(215,89,89,0.12)] text-[var(--danger)]"
                    }`}
                  >
                    {r.decision === "APPROVED" ? "已通过" : "已拒绝"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Detail label="手机号" value={r.phone} />
                  <Detail label="申请权限" value={r.requestedRole ? ROLE_LABEL[r.requestedRole] : "—"} />
                  <Detail label="审核人" value={r.reviewedByName} />
                  <Detail label="审核时间" value={new Date(r.reviewedAt).toLocaleString("zh-CN")} />
                </div>

                {r.decisionNote && (
                  <div className="mt-2 rounded-[12px] bg-white/50 px-3.5 py-2 text-sm">
                    <span className="text-[var(--muted-foreground)]">拒绝理由：</span>
                    <span className="text-[var(--foreground)]">{r.decisionNote}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
