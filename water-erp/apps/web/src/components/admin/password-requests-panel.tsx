"use client";

import {
  Check,
  Copy,
  KeyRound,
  LifeBuoy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  approvePasswordChangeRequest,
  approvePasswordResetRequest,
  fetchCurrentUser,
  fetchPendingPasswordChangeRequests,
  fetchPendingPasswordResetRequests,
  rejectPasswordChangeRequest,
  rejectPasswordResetRequest,
  type AuthUser,
  type PendingPasswordChangeRequest,
  type PendingPasswordResetRequest,
} from "@/lib/api/auth";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Lightweight confirmation / rejection dialog overlay */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  showReasonInput = false,
  reasonPlaceholder,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  showReasonInput?: boolean;
  reasonPlaceholder?: string;
  pending: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");

  // Reset reason whenever dialog opens
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(15,25,45,0.28)] backdrop-blur-[6px]"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Card */}
      <div
        className="panel-surface chromatic-glass glass-calm pointer-events-auto relative w-full max-w-[min(440px,90vw)] rounded-[24px] p-5"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="mb-3 text-[0.96rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]" id="confirm-dialog-title">
          {title}
        </div>
        <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
          {description}
        </p>

        {showReasonInput ? (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
            className="mt-3 w-full resize-none rounded-[14px] border border-white/60 bg-white/70 px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:bg-white/90"
          />
        ) : null}

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center rounded-[14px] border border-white/60 bg-white/62 px-4 py-2.5 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-white/80 disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(reason.trim() || undefined)}
            className={[
              "inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-[14px] px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
              confirmVariant === "danger"
                ? "border border-[rgba(215,89,89,0.18)] bg-[rgba(215,89,89,0.92)] text-white hover:bg-[rgba(200,75,75,0.92)]"
                : "border border-[color:var(--accent)] bg-[color:var(--accent)] text-white hover:opacity-90",
            ].join(" ")}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Badge pill for request status */
function StatusBadge({
  variant,
  children,
}: {
  variant: "matched" | "unmatched" | "pending" | "approved";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    matched:
      "bg-[rgba(92,181,150,0.12)] text-[rgba(42,140,110,0.92)]",
    unmatched:
      "bg-[rgba(233,194,111,0.14)] text-[rgba(176,134,55,0.96)]",
    pending:
      "bg-[rgba(122,168,255,0.12)] text-[color:var(--accent)]",
    approved:
      "bg-[rgba(92,181,150,0.12)] text-[rgba(42,140,110,0.92)]",
  };

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
        styles[variant],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/** Copy-to-clipboard button with brief check-mark feedback */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback – silently ignore
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/60 bg-white/70 px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-white/90"
      aria-label="复制临时密码"
    >
      {copied ? (
        <>
          <Check size={14} strokeWidth={2} className="text-[rgba(42,140,110,0.92)]" />
          <span className="text-[rgba(42,140,110,0.92)]">已复制</span>
        </>
      ) : (
        <>
          <Copy size={14} strokeWidth={1.9} />
          复制
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type ConfirmState =
  | { type: "approve-change"; id: string }
  | { type: "reject-change"; id: string }
  | { type: "approve-reset"; id: string }
  | { type: "reject-reset"; id: string }
  | null;

export function PasswordRequestsPanel() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [changeRequests, setChangeRequests] = useState<
    PendingPasswordChangeRequest[]
  >([]);
  const [resetRequests, setResetRequests] = useState<
    PendingPasswordResetRequest[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [temporaryPasswordNotice, setTemporaryPasswordNotice] = useState<{
    requestedUsername: string;
    applicantName: string;
    temporaryPassword: string;
  } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [isPending, startTransition] = useTransition();

  // ---- Data loading --------------------------------------------------------

  const loadRequests = useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      try {
        const user = await fetchCurrentUser();
        setCurrentUser(user);

        if (user.role !== "admin") {
          setChangeRequests([]);
          setResetRequests([]);
          return;
        }

        const [pendingChange, pendingReset] = await Promise.all([
          fetchPendingPasswordChangeRequests(),
          fetchPendingPasswordResetRequests(),
        ]);
        if (!opts?.signal?.aborted) {
          setChangeRequests(pendingChange);
          setResetRequests(pendingReset);
        }
      } catch (error) {
        if (!opts?.signal?.aborted) {
          setErrorMessage(
            error instanceof Error ? error.message : "加载审批列表失败。",
          );
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadRequests({ signal: controller.signal }).finally(() =>
      setLoading(false),
    );
    return () => controller.abort();
  }, [loadRequests]);

  const handleRefresh = () => {
    setRefreshing(true);
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      await loadRequests();
      setRefreshing(false);
    });
  };

  // ---- Approve / reject handlers ------------------------------------------

  const handleApproveChange = (requestId: string) => {
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      try {
        await approvePasswordChangeRequest(requestId);
        setChangeRequests((prev) => prev.filter((r) => r.id !== requestId));
        setActionMessage("已批准修改密码申请，新密码已生效。");
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "审批失败，请稍后重试。",
        );
      }
      setConfirmState(null);
    });
  };

  const handleRejectChange = (requestId: string, reason?: string) => {
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      try {
        await rejectPasswordChangeRequest(requestId, reason);
        setChangeRequests((prev) => prev.filter((r) => r.id !== requestId));
        setActionMessage("已拒绝该修改密码申请。");
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "拒绝申请失败，请稍后重试。",
        );
      }
      setConfirmState(null);
    });
  };

  const handleApproveReset = (requestId: string) => {
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      try {
        const resetRequest =
          resetRequests.find((item) => item.id === requestId) ?? null;
        const result = await approvePasswordResetRequest(requestId);
        setResetRequests((prev) => prev.filter((r) => r.id !== requestId));
        setTemporaryPasswordNotice({
          requestedUsername: result.requestedUsername,
          applicantName: resetRequest?.applicantName ?? "申请人",
          temporaryPassword: result.temporaryPassword,
        });
        setActionMessage(
          `已为账号 ${result.requestedUsername} 生成临时密码，请尽快线下告知申请人。`,
        );
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "重置密码失败，请稍后重试。",
        );
      }
      setConfirmState(null);
    });
  };

  const handleRejectReset = (requestId: string, reason?: string) => {
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      try {
        await rejectPasswordResetRequest(requestId, reason);
        setResetRequests((prev) => prev.filter((r) => r.id !== requestId));
        setActionMessage("已拒绝该密码重置申请。");
      } catch (error) {
        setActionMessage(
          error instanceof Error
            ? error.message
            : "拒绝重置申请失败，请稍后重试。",
        );
      }
      setConfirmState(null);
    });
  };

  // ---- Derived state -------------------------------------------------------

  const totalCount = changeRequests.length + resetRequests.length;

  // ---- Render helpers ------------------------------------------------------

  const renderConfirmDialog = () => {
    if (!confirmState) return null;

    type ConfigMap = {
      [K in NonNullable<ConfirmState>["type"]]: {
        title: string;
        description: string;
        confirmLabel: string;
        confirmVariant: "primary" | "danger";
        showReason: boolean;
        onConfirm: (reason?: string) => void;
      };
    };

    const configs: ConfigMap = {
      "approve-change": {
        title: "确认批准修改密码",
        description: "批准后新密码将立即生效，该用户下次登录需使用新密码。",
        confirmLabel: "确认批准",
        confirmVariant: "primary",
        showReason: false,
        onConfirm: () => handleApproveChange(confirmState.id),
      },
      "reject-change": {
        title: "拒绝修改密码申请",
        description: "拒绝后该申请将关闭，用户如需改密需重新提交申请。",
        confirmLabel: "确认拒绝",
        confirmVariant: "danger",
        showReason: true,
        onConfirm: (reason) => handleRejectChange(confirmState.id, reason),
      },
      "approve-reset": {
        title: "确认重置密码",
        description: "系统将生成一个随机临时密码，请务必线下转达申请人并提醒立即登录修改。",
        confirmLabel: "生成临时密码",
        confirmVariant: "primary",
        showReason: false,
        onConfirm: () => handleApproveReset(confirmState.id),
      },
      "reject-reset": {
        title: "拒绝密码重置申请",
        description: "拒绝后该申请将关闭，申请人如需重置需重新提交。",
        confirmLabel: "确认拒绝",
        confirmVariant: "danger",
        showReason: true,
        onConfirm: (reason) => handleRejectReset(confirmState.id, reason),
      },
    };

    const config = configs[confirmState.type];

    return (
      <ConfirmDialog
        open
        title={config.title}
        description={config.description}
        confirmLabel={config.confirmLabel}
        confirmVariant={config.confirmVariant}
        showReasonInput={config.showReason}
        reasonPlaceholder="请输入拒绝理由（可选）"
        pending={isPending}
        onConfirm={config.onConfirm}
        onCancel={() => setConfirmState(null)}
      />
    );
  };

  // ---- Early returns -------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="inline-flex items-center gap-3 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />
          正在加载审批面板...
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="rounded-[20px] border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-5 py-4 text-sm text-[color:var(--danger)]">
        {errorMessage}
      </div>
    );
  }

  if (!currentUser || currentUser.role !== "admin") {
    return (
      <div className="rounded-[20px] border border-white/60 bg-white/62 px-6 py-6 text-sm leading-7 text-[color:var(--muted-foreground)]">
        当前账号不是管理员，无法查看密码审批面板。请使用{" "}
        <strong>Swhi-CGZX-admin</strong> 登录后再进行审批。
      </div>
    );
  }

  // ---- Main render ---------------------------------------------------------

  return (
    <div className="space-y-5">
      {renderConfirmDialog()}

      {/* --- Header bar --- */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="command-orb inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/76 bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(238,244,255,0.82))] text-[color:var(--accent)] shadow-[0_10px_22px_rgba(72,120,235,0.08)]">
            <ShieldCheck size={18} strokeWidth={1.9} />
          </span>
          <div>
            <div className="text-[0.96rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              密码审批管理
            </div>
            <div className="mt-0.5 text-sm text-[color:var(--muted-foreground)]">
              当前账号 {currentUser.username}
              {totalCount > 0 && (
                <> &middot; {totalCount} 条待处理</>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || isPending}
          className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-white/60 bg-white/62 px-3.5 text-sm font-medium text-[color:var(--muted-foreground)] transition hover:bg-white/80 hover:text-[color:var(--foreground)] disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.9}
            className={refreshing ? "animate-spin" : ""}
          />
          刷新
        </button>
      </div>

      {/* --- Feedback banner --- */}
      {actionMessage ? (
        <div className="rounded-[16px] border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--foreground)]">
          {actionMessage}
        </div>
      ) : null}

      {/* --- Temporary password notice --- */}
      {temporaryPasswordNotice ? (
        <div className="rounded-[20px] border border-[rgba(233,194,111,0.28)] bg-[linear-gradient(180deg,rgba(255,251,240,0.92),rgba(255,246,230,0.82))] px-5 py-4 shadow-[0_18px_40px_rgba(176,134,55,0.08)]">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-white/78 bg-white/78 text-[rgba(176,134,55,0.92)] shadow-[0_10px_18px_rgba(176,134,55,0.08)]">
              <KeyRound size={16} strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                临时密码已生成
              </div>
              <div className="mt-2 space-y-1 text-sm leading-6 text-[rgba(108,91,52,0.94)]">
                <div>
                  账号：<span className="font-medium">{temporaryPasswordNotice.requestedUsername}</span>
                </div>
                <div>
                  申请人：<span className="font-medium">{temporaryPasswordNotice.applicantName}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <code className="inline-flex items-center rounded-[12px] border border-[rgba(222,183,100,0.28)] bg-white/80 px-4 py-2.5 text-base font-semibold tracking-[0.16em] text-[rgba(90,74,41,0.96)]">
                  {temporaryPasswordNotice.temporaryPassword}
                </code>
                <CopyButton text={temporaryPasswordNotice.temporaryPassword} />
              </div>
              <div className="mt-2 text-xs leading-5 text-[rgba(130,108,60,0.82)]">
                临时密码仅展示一次，请立即通知申请人登录后修改。
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* --- Empty state --- */}
      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[20px] border border-white/55 bg-white/52 py-16 text-center">
          <span className="command-orb mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(241,245,251,0.88))] text-[color:var(--muted-foreground)] shadow-[0_10px_22px_rgba(72,120,235,0.06)]">
            <ShieldCheck size={20} strokeWidth={1.6} />
          </span>
          <div className="text-sm font-medium text-[color:var(--foreground)]">
            当前没有待处理的密码申请
          </div>
          <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            新的申请会自动出现在此处
          </div>
        </div>
      ) : (
        <>
          {/* --- Change requests section --- */}
          {changeRequests.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <KeyRound
                  size={15}
                  strokeWidth={1.9}
                  className="text-[color:var(--accent)]"
                />
                <span className="text-sm font-semibold text-[color:var(--foreground)]">
                  修改密码申请
                </span>
                <span className="text-sm text-[color:var(--muted-foreground)]">
                  {changeRequests.length} 条
                </span>
              </div>

              <div className="space-y-3">
                {changeRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.72))] px-4 py-3.5 shadow-[0_12px_28px_rgba(59,89,143,0.06)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/70 bg-white/74 text-sm font-semibold text-[color:var(--accent)]">
                          {request.user.username.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-[color:var(--foreground)]">
                            {request.user.username}
                          </div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            {request.user.displayName}
                          </div>
                        </div>
                      </div>
                      <StatusBadge variant="pending">待审批</StatusBadge>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-white/50 px-3.5 py-2.5 text-sm">
                      <span className="text-[color:var(--muted-foreground)]">
                        申请时间
                      </span>
                      <span className="font-medium text-[color:var(--foreground)]">
                        {new Date(request.requestedAt).toLocaleString("zh-CN")}
                      </span>
                    </div>

                    <div className="mt-3 flex gap-2.5">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setConfirmState({
                            type: "reject-change",
                            id: request.id,
                          })
                        }
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[rgba(215,89,89,0.16)] bg-[rgba(255,243,243,0.84)] px-3.5 py-2.5 text-sm font-medium text-[color:var(--danger)] transition hover:bg-[rgba(255,230,230,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <X size={14} strokeWidth={2} />
                        拒绝
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          setConfirmState({
                            type: "approve-change",
                            id: request.id,
                          })
                        }
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[color:var(--accent)] bg-[color:var(--accent)] px-3.5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Check size={14} strokeWidth={2.2} />
                        批准
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* --- Reset requests section --- */}
          {resetRequests.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <LifeBuoy
                  size={15}
                  strokeWidth={1.9}
                  className="text-[rgba(176,134,55,0.92)]"
                />
                <span className="text-sm font-semibold text-[color:var(--foreground)]">
                  忘记密码重置申请
                </span>
                <span className="text-sm text-[color:var(--muted-foreground)]">
                  {resetRequests.length} 条
                </span>
              </div>

              <div className="space-y-3">
                {resetRequests.map((request) => {
                  const matchedUser = request.matchedUser;
                  const canApprove = Boolean(matchedUser);

                  return (
                    <div
                      key={request.id}
                      className="rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.72))] px-4 py-3.5 shadow-[0_12px_28px_rgba(59,89,143,0.06)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[color:var(--foreground)]">
                            {request.requestedUsername}
                          </div>
                          <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                            申请人：{request.applicantName}
                          </div>
                        </div>
                        <StatusBadge
                          variant={canApprove ? "matched" : "unmatched"}
                        >
                          {canApprove ? "已匹配账号" : "待人工核验"}
                        </StatusBadge>
                      </div>

                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-white/50 px-3.5 py-2.5">
                          <span className="text-[color:var(--muted-foreground)]">
                            联系方式
                          </span>
                          <span className="font-medium text-[color:var(--foreground)]">
                            {request.applicantContact}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-white/50 px-3.5 py-2.5">
                          <span className="text-[color:var(--muted-foreground)]">
                            申请时间
                          </span>
                          <span className="font-medium text-[color:var(--foreground)]">
                            {new Date(request.requestedAt).toLocaleString(
                              "zh-CN",
                            )}
                          </span>
                        </div>
                        <div className="rounded-[14px] bg-white/50 px-3.5 py-2.5">
                          <span className="text-[color:var(--muted-foreground)]">
                            匹配结果
                          </span>
                          <div className="mt-1 text-sm font-medium text-[color:var(--foreground)]">
                            {matchedUser
                              ? `${matchedUser.username}（${matchedUser.displayName}）`
                              : "未匹配到有效账号，需先线下核实。"}
                          </div>
                        </div>
                      </div>

                      {!canApprove ? (
                        <div className="mt-3 rounded-[14px] border border-[rgba(233,194,111,0.2)] bg-[rgba(255,250,241,0.8)] px-3.5 py-2.5 text-sm leading-6 text-[rgba(130,108,60,0.92)]">
                          无法直接生成临时密码，请先核实账号信息后再决定是否拒绝申请。
                        </div>
                      ) : null}

                      <div className="mt-3 flex gap-2.5">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            setConfirmState({
                              type: "reject-reset",
                              id: request.id,
                            })
                          }
                          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[rgba(215,89,89,0.16)] bg-[rgba(255,243,243,0.84)] px-3.5 py-2.5 text-sm font-medium text-[color:var(--danger)] transition hover:bg-[rgba(255,230,230,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <X size={14} strokeWidth={2} />
                          拒绝
                        </button>
                        <button
                          type="button"
                          disabled={isPending || !canApprove}
                          onClick={() =>
                            setConfirmState({
                              type: "approve-reset",
                              id: request.id,
                            })
                          }
                          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[color:var(--accent)] bg-[color:var(--accent)] px-3.5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <KeyRound size={14} strokeWidth={2} />
                          生成临时密码
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
