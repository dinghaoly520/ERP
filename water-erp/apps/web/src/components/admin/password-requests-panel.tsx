"use client";

import {
  Check,
  Copy,
  IdCard,
  KeyRound,
  LifeBuoy,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  approvePasswordChangeRequest,
  approvePasswordResetRequest,
  approveProfileChange,
  fetchCurrentUser,
  fetchPendingPasswordChangeRequests,
  fetchPendingPasswordResetRequests,
  fetchPendingProfileChanges,
  rejectPasswordChangeRequest,
  rejectPasswordResetRequest,
  rejectProfileChange,
  type PendingPasswordChangeRequest,
  type PendingPasswordResetRequest,
  type PendingProfileChange,
} from "@/lib/api/auth";
import { Modal } from "@/components/workbench";

/** 资料字段中文名（审批对照展示用） */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  displayName: "姓名",
  email: "邮箱",
  phone: "手机",
  officeLocation: "办公位置",
  company: "公司",
  departmentId: "部门",
  avatar: "头像",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** 状态 pill —— 语义色轻底（color-mix 从 CSS 变量派生） */
function Pill({ tone, children }: { tone: "accent" | "success" | "warning"; children: React.ReactNode }) {
  const tones = {
    accent: "bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]",
    success: "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-[var(--success)]",
    warning: "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-[var(--warning)]",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Lightweight confirmation / rejection dialog, powered by the app-wide <Modal> */
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
            className={`neu-btn-primary ${confirmVariant === "danger" ? "is-danger" : ""}`}
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
          placeholder={reasonPlaceholder}
          rows={3}
          className="neu-input w-full resize-none text-sm"
        />
      )}
    </Modal>
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
    <button type="button" onClick={handleCopy} className="neu-btn-xs" aria-label="复制临时密码">
      {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.9} />}
      {copied ? "已复制" : "复制"}
    </button>
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

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type ConfirmState =
  | { type: "approve-change"; id: string }
  | { type: "reject-change"; id: string }
  | { type: "approve-reset"; id: string }
  | { type: "reject-reset"; id: string }
  | { type: "approve-profile"; id: string }
  | { type: "reject-profile"; id: string }
  | null;

export function PasswordRequestsPanel() {
  const [role, setRole] = useState<string | null>(null);
  const [tab, setTab] = useState<"change" | "reset" | "profile">("change");
  const [changeRequests, setChangeRequests] = useState<PendingPasswordChangeRequest[]>([]);
  const [resetRequests, setResetRequests] = useState<PendingPasswordResetRequest[]>([]);
  const [profileRequests, setProfileRequests] = useState<PendingProfileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [temporaryPasswordNotice, setTemporaryPasswordNotice] = useState<{
    requestedUsername: string;
    applicantName: string;
    temporaryPassword: string;
  } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [isPending, startTransition] = useTransition();

  const loadRequests = useCallback(async () => {
    try {
      const user = await fetchCurrentUser();
      setRole(user.role);
      if (user.role !== "admin" && user.role !== "leader") {
        setChangeRequests([]);
        setResetRequests([]);
        setProfileRequests([]);
        return;
      }
      const [pendingChange, pendingReset, pendingProfile] = await Promise.all([
        fetchPendingPasswordChangeRequests(),
        fetchPendingPasswordResetRequests(),
        fetchPendingProfileChanges(),
      ]);
      setChangeRequests(pendingChange);
      setResetRequests(pendingReset);
      setProfileRequests(pendingProfile);
    } catch {
      /* 列表加载失败保持空态 */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadRequests().finally(() => setLoading(false));
  }, [loadRequests]);

  const handleRefresh = () => {
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      await loadRequests();
    });
  };

  // ---- Approve / reject handlers ------------------------------------------

  const handleApproveChange = (requestId: string) => {
    setActionMessage(null);
    startTransition(async () => {
      try {
        await approvePasswordChangeRequest(requestId);
        setChangeRequests((prev) => prev.filter((r) => r.id !== requestId));
        setActionMessage("已批准修改密码申请，新密码已生效，该用户已登录会话已下线。");
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "审批失败，请稍后重试。");
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
        setActionMessage(error instanceof Error ? error.message : "拒绝申请失败，请稍后重试。");
      }
      setConfirmState(null);
    });
  };

  const handleApproveReset = (requestId: string) => {
    setActionMessage(null);
    setTemporaryPasswordNotice(null);
    startTransition(async () => {
      try {
        const resetRequest = resetRequests.find((item) => item.id === requestId) ?? null;
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
        setActionMessage(error instanceof Error ? error.message : "重置密码失败，请稍后重试。");
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
        setActionMessage(error instanceof Error ? error.message : "拒绝重置申请失败，请稍后重试。");
      }
      setConfirmState(null);
    });
  };

  const handleApproveProfile = (requestId: string) => {
    setActionMessage(null);
    startTransition(async () => {
      try {
        const result = await approveProfileChange(requestId);
        setProfileRequests((prev) => prev.filter((r) => r.id !== requestId));
        setActionMessage(`已通过「${result.username}」的资料变更，新资料已生效并已通知申请人。`);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "审批失败，请稍后重试。");
      }
      setConfirmState(null);
    });
  };

  const handleRejectProfile = (requestId: string, note?: string) => {
    setActionMessage(null);
    startTransition(async () => {
      try {
        await rejectProfileChange(requestId, note);
        setProfileRequests((prev) => prev.filter((r) => r.id !== requestId));
        setActionMessage("已拒绝该资料变更申请，申请人当前资料保持不变。");
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "拒绝失败，请稍后重试。");
      }
      setConfirmState(null);
    });
  };

  // ---- Early returns -------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="inline-flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />
          正在加载审批面板...
        </div>
      </div>
    );
  }

  if (role !== "admin" && role !== "leader") {
    return (
      <div className="rounded-[16px] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-6 py-6 text-sm leading-7 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
        当前账号无密码审批权限，请使用管理员账号登录。
      </div>
    );
  }

  const totalCount = changeRequests.length + resetRequests.length + profileRequests.length;

  return (
    <div className="space-y-4">
      {renderConfirmDialog()}

      {/* 工具条：内层 tab + 刷新 */}
      <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
        <div className="neu-tab-bar">
          <button type="button" className={`neu-tab ${tab === "change" ? "is-active" : ""}`} onClick={() => setTab("change")}>
            <KeyRound size={13} strokeWidth={1.9} />
            修改密码申请
            <span className="neu-tab-count">{changeRequests.length}</span>
          </button>
          <button type="button" className={`neu-tab ${tab === "reset" ? "is-active" : ""}`} onClick={() => setTab("reset")}>
            <LifeBuoy size={13} strokeWidth={1.9} />
            忘记密码重置
            <span className="neu-tab-count">{resetRequests.length}</span>
          </button>
          <button type="button" className={`neu-tab ${tab === "profile" ? "is-active" : ""}`} onClick={() => setTab("profile")}>
            <IdCard size={13} strokeWidth={1.9} />
            资料变更
            <span className="neu-tab-count">{profileRequests.length}</span>
          </button>
        </div>
        <button type="button" onClick={handleRefresh} disabled={isPending} className="neu-btn-xs" aria-label="刷新">
          <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
        </button>
      </div>

      {/* --- Feedback banner --- */}
      {actionMessage ? (
        <div className="rounded-[14px] bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-4 py-3 text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.55)]">
          {actionMessage}
        </div>
      ) : null}

      {/* --- Temporary password notice --- */}
      {temporaryPasswordNotice ? (
        <div className="neu-surface flex items-start gap-3 px-5 py-4">
          <span className="neu-icon-well inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-[var(--warning)]">
            <KeyRound size={16} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">
              临时密码已生成
            </div>
            <div className="mt-1.5 text-sm leading-6 text-[var(--muted-foreground)]">
              账号 <span className="font-medium text-[var(--foreground)]">{temporaryPasswordNotice.requestedUsername}</span>
              （申请人：{temporaryPasswordNotice.applicantName}）
            </div>
            <div className="mt-3 flex items-center gap-3">
              <code className="inline-flex items-center rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-4 py-2 text-base font-semibold tracking-[0.16em] tabular-nums text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.45),inset_2px_2px_5px_oklch(0.55_0.03_258/0.1)]">
                {temporaryPasswordNotice.temporaryPassword}
              </code>
              <CopyButton text={temporaryPasswordNotice.temporaryPassword} />
            </div>
            <div className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
              临时密码仅展示一次，请立即通知申请人登录后修改。
            </div>
          </div>
        </div>
      ) : null}

      {/* --- 修改密码申请表 --- */}
      {tab === "change" &&
        (changeRequests.length === 0 ? (
          <div className="neu-table-card">
            <EmptyState
              icon={<KeyRound size={20} strokeWidth={1.6} />}
              title={totalCount === 0 ? "当前没有待处理的密码申请" : "没有待审批的修改密码申请"}
              hint="新的申请会自动出现在此处"
            />
          </div>
        ) : (
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th>申请账号</th>
                    <th>联系方式</th>
                    <th>申请时间</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {changeRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <div className="text-sm font-semibold text-[var(--foreground)]">
                          {request.user.username}
                          <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                            {request.user.displayName}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)]">{request.user.company ?? "—"}</div>
                      </td>
                      <td>
                        <div className="text-sm text-[var(--foreground)]">{request.user.phone ?? "—"}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{request.user.email ?? "—"}</div>
                      </td>
                      <td className="text-sm tabular-nums text-[var(--muted-foreground)]">
                        {new Date(request.requestedAt).toLocaleString("zh-CN")}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirmState({ type: "reject-change", id: request.id })}
                            className="neu-btn-xs is-danger"
                          >
                            <X size={12} strokeWidth={2} />
                            拒绝
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setConfirmState({ type: "approve-change", id: request.id })}
                            className="neu-btn-xs is-success"
                          >
                            <Check size={12} strokeWidth={2.2} />
                            批准
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

      {/* --- 忘记密码重置表 --- */}
      {tab === "reset" &&
        (resetRequests.length === 0 ? (
          <div className="neu-table-card">
            <EmptyState
              icon={<LifeBuoy size={20} strokeWidth={1.6} />}
              title="没有待处理的重置申请"
              hint="新的申请会自动出现在此处"
            />
          </div>
        ) : (
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[820px]">
                <thead>
                  <tr>
                    <th>申请账号</th>
                    <th>申请人</th>
                    <th>联系方式</th>
                    <th>匹配状态</th>
                    <th>申请时间</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {resetRequests.map((request) => {
                    const matchedUser = request.matchedUser;
                    const canApprove = Boolean(matchedUser);
                    return (
                      <tr key={request.id}>
                        <td>
                          <div className="text-sm font-semibold text-[var(--foreground)]">{request.requestedUsername}</div>
                          {matchedUser ? (
                            <div className="text-xs text-[var(--muted-foreground)]">{matchedUser.displayName}</div>
                          ) : (
                            <div className="text-xs text-[var(--muted-foreground)]">未匹配到有效账号</div>
                          )}
                        </td>
                        <td className="text-sm text-[var(--foreground)]">{request.applicantName}</td>
                        <td className="text-sm text-[var(--muted-foreground)]">{request.applicantContact}</td>
                        <td>
                          <Pill tone={canApprove ? "success" : "warning"}>
                            {canApprove ? "已匹配账号" : "待人工核验"}
                          </Pill>
                        </td>
                        <td className="text-sm tabular-nums text-[var(--muted-foreground)]">
                          {new Date(request.requestedAt).toLocaleString("zh-CN")}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setConfirmState({ type: "reject-reset", id: request.id })}
                              className="neu-btn-xs is-danger"
                            >
                              <X size={12} strokeWidth={2} />
                              拒绝
                            </button>
                            <button
                              type="button"
                              disabled={isPending || !canApprove}
                              onClick={() => setConfirmState({ type: "approve-reset", id: request.id })}
                              className="neu-btn-xs is-success"
                              title={canApprove ? "生成临时密码" : "未匹配账号，无法批准"}
                            >
                              <KeyRound size={12} strokeWidth={2} />
                              生成临时密码
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      {/* --- 资料变更表 --- */}
      {tab === "profile" &&
        (profileRequests.length === 0 ? (
          <div className="neu-table-card">
            <EmptyState
              icon={<IdCard size={20} strokeWidth={1.6} />}
              title="没有待审批的资料变更"
              hint="个人中心提交的资料修改会出现在此处"
            />
          </div>
        ) : (
          <div className="neu-table-card">
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th>申请账号</th>
                    <th>变更内容（当前值 → 新值）</th>
                    <th>申请时间</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {profileRequests.map((request) => {
                    const entries = Object.entries(request.payload) as [string, string | null][];
                    return (
                      <tr key={request.id}>
                        <td>
                          <div className="text-sm font-semibold text-[var(--foreground)]">
                            {request.user.username}
                            <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                              {request.user.displayName}
                            </span>
                          </div>
                          <div className="text-xs text-[var(--muted-foreground)]">{request.user.company ?? "—"}</div>
                        </td>
                        <td>
                          <div className="flex flex-col gap-1">
                            {entries.map(([field, next]) => {
                              const label = PROFILE_FIELD_LABELS[field] ?? field;
                              const oldVal =
                                field === "avatar"
                                  ? request.user.avatar ? "已设置" : "未设置"
                                  : (request.user as unknown as Record<string, string | null>)[field] ?? "—";
                              const newVal = field === "avatar" ? "更换新图片" : next ?? "（清除）";
                              return (
                                <div key={field} className="text-xs leading-5">
                                  <span className="font-medium text-[var(--foreground)]">{label}</span>
                                  <span className="mx-1.5 text-[var(--muted-foreground)]">：</span>
                                  <span className="text-[var(--muted-foreground)]">{oldVal}</span>
                                  <span className="mx-1 text-[var(--accent)]">→</span>
                                  <span className="font-medium text-[var(--accent)]">{newVal}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="text-sm tabular-nums text-[var(--muted-foreground)]">
                          {new Date(request.requestedAt).toLocaleString("zh-CN")}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setConfirmState({ type: "reject-profile", id: request.id })}
                              className="neu-btn-xs is-danger"
                            >
                              <X size={12} strokeWidth={2} />
                              拒绝
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setConfirmState({ type: "approve-profile", id: request.id })}
                              className="neu-btn-xs is-success"
                            >
                              <Check size={12} strokeWidth={2.2} />
                              通过
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );

  // ---- Confirm dialog renderer ---------------------------------------------

  function renderConfirmDialog() {
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
      "approve-profile": {
        title: "通过资料变更",
        description: "通过后新资料立即生效，申请人将收到通知。",
        confirmLabel: "确认通过",
        confirmVariant: "primary",
        showReason: false,
        onConfirm: () => handleApproveProfile(confirmState.id),
      },
      "reject-profile": {
        title: "拒绝资料变更",
        description: "拒绝后申请人当前资料保持不变，将收到拒绝通知。",
        confirmLabel: "确认拒绝",
        confirmVariant: "danger",
        showReason: true,
        onConfirm: (reason) => handleRejectProfile(confirmState.id, reason),
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
  }
}
