"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Ban,
  CircleCheck,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Trash2,
  UserCog,
  Search,
} from "lucide-react";
import { Modal } from "@/components/workbench";
import { ApiError } from "@/lib/api";
import { fetchCurrentUser, type AuthRole } from "@/lib/api/auth";
import { RegistrationReviewPanel } from "@/components/admin/registration-review-panel";
import { PasswordRequestsPanel } from "@/components/admin/password-requests-panel";
import { ROLE_LABELS } from "@/lib/role-labels";
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  freezeAccount,
  resetAccountPassword,
  unfreezeAccount,
  updateAccount,
  type AdminAccount,
} from "@/lib/api/accounts";

// 权限设定与注册/审核一致：管理权限 → leader、办公权限 → staff
const PERMISSION_OPTIONS = [
  { value: "management", label: "管理权限", role: "leader" as AuthRole },
  { value: "office", label: "办公权限", role: "staff" as AuthRole },
];

const PERMISSION_ROLE: Record<string, AuthRole> = { management: "leader", office: "staff" };

/** 内部角色 → 权限档位；特殊角色（admin/供应商/专家/商城/开标主持）返回 null 不可改 */
function roleToPermission(role: AuthRole): "management" | "office" | null {
  if (role === "leader") return "management";
  if (role === "staff") return "office";
  return null;
}

/** 列表展示：内部角色显示权限档位，特殊角色显示原角色标签 */
function permissionLabel(role: AuthRole): string {
  const p = roleToPermission(role);
  if (p) return PERMISSION_OPTIONS.find((o) => o.value === p)!.label;
  return ROLE_LABELS[role] ?? role;
}

const inputCls = "neu-input w-full text-sm";

function statusOf(account: AdminAccount): "frozen" | "pending" | "active" {
  if (account.isFrozen) return "frozen";
  if (!account.isActive) return "pending";
  return "active";
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  frozen: { label: "已冻结", cls: "bg-[rgba(215,89,89,0.12)] text-[color:var(--danger)]" },
  pending: { label: "未激活", cls: "bg-[rgba(233,194,111,0.14)] text-[rgba(176,134,55,0.96)]" },
  active: { label: "正常", cls: "bg-[rgba(92,181,150,0.12)] text-[rgba(42,140,110,0.92)]" },
};

/**
 * 错误文案归一：403 = 会话身份错位（页面是旧版本代码、或共享 cookie 被其他
 * 标签页登录的普通账号覆盖，后端按 cookie 认成了非管理员）——刷新页面即可恢复，
 * 明确告知用户怎么办，而不是干巴巴一句「无权访问」。
 */
function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 403) {
    return "当前会话身份已变化（可能被其他标签页的登录覆盖），请刷新页面后重试。";
  }
  return e instanceof Error ? e.message : fallback;
}

export function AccountManagementPanel() {
  const [currentUser, setCurrentUser] = useState<AuthRole | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  // 三合一（2026-08-21）：注册审核 / 密码审批并入账号管理
  const [tab, setTab] = useState<"list" | "registration" | "password">("list");

  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; account: AdminAccount } | null
  >(null);
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [confirmState, setConfirmState] = useState<
    { type: "delete" | "freeze" | "unfreeze"; account: AdminAccount } | null
  >(null);

  const loadAccounts = useCallback(async () => {
    try {
      const user = await fetchCurrentUser();
      setCurrentUser(user.role);
      setCurrentUserId(user.id);
      if (user.role !== "admin") {
        setAccounts([]);
        return;
      }
      setAccounts(await fetchAccounts());
    } catch (error) {
      setErrorMessage(friendlyError(error, "加载账号列表失败。"));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadAccounts().finally(() => setLoading(false));
  }, [loadAccounts]);

  const refresh = () => {
    setActionMessage(null);
    startTransition(async () => {
      await loadAccounts();
    });
  };

  const filtered = accounts.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      a.username.toLowerCase().includes(q) ||
      a.displayName.toLowerCase().includes(q) ||
      (a.company ?? "").toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="inline-flex items-center gap-3 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />
          正在加载账号列表...
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

  if (currentUser !== "admin") {
    return (
      <div className="rounded-[20px] border border-white/60 bg-white/62 px-6 py-6 text-sm leading-7 text-[color:var(--muted-foreground)]">
        当前账号不是管理员，无法使用账号管理。请使用管理员账号登录。
      </div>
    );
  }

  const SUBTITLE: Record<typeof tab, string> = {
    list: "账号增删 · 改密 · 权限 · 冻结",
    registration: "注册申请的准入审核（管理/办公权限分配）",
    password: "改密 · 忘记密码重置 · 资料变更审批",
  };

  return (
    <div className="space-y-5">
      {/* 页面标题卡片（与其他板块同款 page-hero）+ tab 第二行 */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <UserCog size={17} strokeWidth={1.9} />
            </div>
            <div>
              <div className="page-hero__title">账号管理</div>
              <div className="page-hero__sub">{SUBTITLE[tab]}</div>
            </div>
          </div>

          <div className="page-hero__right">
            <button
              type="button"
              onClick={refresh}
              disabled={isPending}
              className="neu-btn-xs"
              aria-label="刷新"
            >
              <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
            </button>
            {tab === "list" ? (
              <button
                type="button"
                onClick={() => setFormState({ mode: "create" })}
                className="neu-btn-soft"
              >
                <Plus size={15} strokeWidth={2} />
                新增账号
              </button>
            ) : null}
          </div>
        </div>

        <div className="page-hero__divider" />
      </div>

      {/* 工具栏卡片：文字下划线 tab + 搜索（白色为主的克制风格） */}
      <div className="wb-toolbar">
        <div className="flex w-full flex-wrap items-end justify-between gap-3 border-b border-[color-mix(in_oklch,var(--muted-foreground)_16%,transparent)]">
          <div className="flex" role="tablist" aria-label="账号管理视图">
            <button type="button" role="tab" aria-selected={tab === "list"} className={`page-tab ${tab === "list" ? "is-active" : ""}`} onClick={() => setTab("list")}>
              <UserCog size={13} strokeWidth={1.9} />
              账号列表
            </button>
            <button type="button" role="tab" aria-selected={tab === "registration"} className={`page-tab ${tab === "registration" ? "is-active" : ""}`} onClick={() => setTab("registration")}>
              <ShieldCheck size={13} strokeWidth={1.9} />
              注册审核
            </button>
            <button type="button" role="tab" aria-selected={tab === "password"} className={`page-tab ${tab === "password" ? "is-active" : ""}`} onClick={() => setTab("password")}>
              <KeyRound size={13} strokeWidth={1.9} />
              安全审批
            </button>
          </div>
          {/* 列表 tab 显示搜索框；其他 tab 用等高占位保持工具栏高度恒定 */}
          {tab === "list" ? (
            <div className="relative mb-1.5 w-full max-w-[220px] min-w-[160px]">
              <Search size={14} className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索用户名 / 姓名 / 公司"
                aria-label="搜索账号"
                className="neu-input !pl-9 w-full text-sm"
              />
            </div>
          ) : (
            <div aria-hidden className="mb-1.5 h-[44px] w-full max-w-[220px] min-w-[160px]" />
          )}
        </div>
      </div>

      {tab === "registration" ? (
        <RegistrationReviewPanel
          onAccountsChanged={() => {
            // 通过/拒绝注册改变了账号集合，静默刷新列表数据——切回账号列表无需手动刷新
            startTransition(async () => {
              await loadAccounts();
            });
          }}
        />
      ) : tab === "password" ? (
        <PasswordRequestsPanel />
      ) : (
      <>

      {actionMessage ? (
        <div className="rounded-[16px] border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--foreground)]">
          {actionMessage}
        </div>
      ) : null}

      {/* 列表 */}
      <div className="overflow-hidden rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.72))] shadow-[0_12px_28px_rgba(59,89,143,0.06)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/70 text-center text-xs text-[color:var(--muted-foreground)]">
                <th className="px-4 py-3 font-medium">账号</th>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">权限 / 角色</th>
                <th className="px-4 py-3 font-medium">公司 / 部门</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => {
                const status = statusOf(account);
                const meta = STATUS_META[status];
                const self = currentUserId && account.id === currentUserId;
                return (
                  <tr key={account.id} className="border-b border-white/55 last:border-0 hover:bg-white/40">
                    <td className="px-4 py-3 text-center">
                      <div className="font-medium text-[color:var(--foreground)]">
                        {account.username}
                        {self ? (
                          <span className="ml-1.5 text-[10px] text-[color:var(--muted-foreground)]">(我)</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">{account.phone ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-center text-[color:var(--foreground)]">{account.displayName}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-[rgba(122,168,255,0.12)] px-2.5 py-1 text-[11px] font-semibold leading-none text-[color:var(--accent)]">
                        {permissionLabel(account.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-[color:var(--muted-foreground)]">
                      <div>{account.company ?? "—"}</div>
                      <div className="text-xs">{account.departmentName ?? ""}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${meta.cls}`}>
                        {status === "frozen" ? <Snowflake size={11} strokeWidth={2} /> : status === "active" ? <CircleCheck size={11} strokeWidth={2} /> : null}
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFormState({ mode: "edit", account })}
                          className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-white/60 bg-white/62 px-2.5 text-xs font-medium text-[color:var(--foreground)] transition hover:bg-white/85"
                          title="修改信息 / 权限"
                        >
                          <Pencil size={13} strokeWidth={1.9} />
                          权限
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetTarget(account)}
                          className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-white/60 bg-white/62 px-2.5 text-xs font-medium text-[color:var(--foreground)] transition hover:bg-white/85"
                          title="修改密码"
                        >
                          <KeyRound size={13} strokeWidth={1.9} />
                          改密
                        </button>
                        <button
                          type="button"
                          disabled={!!self}
                          onClick={() =>
                            setConfirmState({
                              type: status === "frozen" ? "unfreeze" : "freeze",
                              account,
                            })
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-white/60 bg-white/62 px-2.5 text-xs font-medium text-[color:var(--foreground)] transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
                          title={status === "frozen" ? "解冻" : "冻结"}
                        >
                          <Ban size={13} strokeWidth={1.9} />
                          {status === "frozen" ? "解冻" : "冻结"}
                        </button>
                        <button
                          type="button"
                          disabled={!!self}
                          onClick={() => setConfirmState({ type: "delete", account })}
                          className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-[rgba(215,89,89,0.16)] bg-[rgba(255,243,243,0.84)] px-2.5 text-xs font-medium text-[color:var(--danger)] transition hover:bg-[rgba(255,230,230,0.9)] disabled:cursor-not-allowed disabled:opacity-40"
                          title="删除"
                        >
                          <Trash2 size={13} strokeWidth={1.9} />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <span className="command-orb mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(241,245,251,0.88))] text-[color:var(--muted-foreground)] shadow-[0_10px_22px_rgba(72,120,235,0.06)]">
              <UserCog size={20} strokeWidth={1.6} />
            </span>
            <div className="text-sm font-medium text-[color:var(--foreground)]">没有匹配的账号</div>
            <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">点击右上角「新增账号」创建</div>
          </div>
        ) : null}
      </div>

      {/* 新增 / 编辑表单 */}
      {formState ? (
        <AccountFormModal
          mode={formState.mode}
          account={formState.mode === "edit" ? formState.account : undefined}
          pending={isPending}
          onClose={() => setFormState(null)}
          onDone={(msg) => {
            setFormState(null);
            setActionMessage(msg);
            refresh();
          }}
        />
      ) : null}

      {/* 修改密码 */}
      {resetTarget ? (
        <ResetPasswordModal
          account={resetTarget}
          pending={isPending}
          onClose={() => setResetTarget(null)}
          onDone={(msg) => {
            setResetTarget(null);
            setActionMessage(msg);
          }}
        />
      ) : null}

      {/* 删除 / 冻结 / 解冻 确认 */}
      {confirmState ? (
        <ConfirmActionModal
          type={confirmState.type}
          account={confirmState.account}
          pending={isPending}
          onClose={() => setConfirmState(null)}
          onDone={(msg) => {
            setConfirmState(null);
            setActionMessage(msg);
            refresh();
          }}
        />
      ) : null}
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function AccountFormModal({
  mode,
  account,
  pending,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  account?: AdminAccount;
  pending: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [username, setUsername] = useState(account?.username ?? "");
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [password, setPassword] = useState("");
  // 权限档位：create 默认办公权限；edit 由当前角色反推，特殊角色不可改
  const initialPermission = account ? roleToPermission(account.role) : null;
  const permissionEditable = mode === "create" || initialPermission !== null;
  const [permission, setPermission] = useState<"management" | "office">(
    initialPermission ?? "office",
  );
  const [company, setCompany] = useState(account?.company ?? "");
  const [departmentName, setDepartmentName] = useState(account?.departmentName ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (mode === "create") {
      if (username.trim().length < 2) return setError("请输入用户名");
      if (password.length < 6) return setError("密码不少于 6 位");
      if (!displayName.trim()) return setError("请输入姓名");
    }
    try {
      if (mode === "create") {
        await createAccount({
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          role: PERMISSION_ROLE[permission],
          company: company.trim() || undefined,
          departmentName: departmentName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
        });
        onDone(`已新增账号「${username.trim()}」。`);
      } else if (account) {
        await updateAccount(account.id, {
          displayName: displayName.trim(),
          // 特殊角色（管理员/供应商/专家/商城/开标主持）不改权限
          ...(permissionEditable ? { role: PERMISSION_ROLE[permission] } : {}),
          company: company.trim() || null,
          departmentName: departmentName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
        });
        onDone(`已更新账号「${account.username}」。`);
      }
    } catch (e) {
      setError(friendlyError(e, "操作失败，请稍后重试。"));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "新增账号" : `编辑账号「${account?.username}」`}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="neu-btn-soft">
            取消
          </button>
          <button type="button" onClick={submit} disabled={pending} className="neu-btn-primary">
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            {mode === "create" ? "创建账号" : "保存"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
            用户名 {mode === "create" ? <span className="text-[color:var(--danger)]">*</span> : null}
          </span>
          <input
            type="text"
            value={username}
            disabled={mode === "edit"}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="登录账号"
            className={`${inputCls} disabled:opacity-50`}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
              姓名 {mode === "create" ? <span className="text-[color:var(--danger)]">*</span> : null}
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="请输入姓名"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
              权限 <span className="text-[color:var(--danger)]">*</span>
            </span>
            {permissionEditable ? (
              <div className="grid grid-cols-2 gap-2">
                {PERMISSION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={!permissionEditable}
                    onClick={() => setPermission(opt.value as "management" | "office")}
                    className={`rounded-[8px] px-3 py-2.5 text-xs font-medium transition-all ${
                      permission === opt.value
                        ? "bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_40%,transparent)]"
                        : "bg-[var(--surface)] text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.6)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-[8px] bg-[var(--surface)] px-3 py-2.5 text-xs leading-5 text-[color:var(--muted-foreground)]">
                特殊角色（{permissionLabel(account!.role)}），不可在此修改权限
              </div>
            )}
          </label>
        </div>
        {mode === "create" ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
              初始密码 <span className="text-[color:var(--danger)]">*</span>
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className={inputCls}
            />
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">公司</span>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="公司名称" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">部门</span>
            <input type="text" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} placeholder="部门" className={inputCls} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">手机号</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">邮箱</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className={inputCls} />
          </label>
        </div>
        {error ? <p className="text-xs text-[color:var(--danger)]">{error}</p> : null}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  account,
  pending,
  onClose,
  onDone,
}: {
  account: AdminAccount;
  pending: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 6) return setError("密码不少于 6 位");
    try {
      await resetAccountPassword(account.id, password);
      onDone(`已重置账号「${account.username}」的密码，其已登录的会话已全部下线。`);
    } catch (e) {
      setError(friendlyError(e, "重置失败，请稍后重试。"));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`修改密码「${account.username}」`}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="neu-btn-soft">
            取消
          </button>
          <button type="button" onClick={submit} disabled={pending} className="neu-btn-primary">
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            确认修改
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs leading-6 text-[color:var(--muted-foreground)]">
          修改后该账号所有已登录会话将立即失效，需用新密码重新登录。
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
            新密码 <span className="text-[color:var(--danger)]">*</span>
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            className={inputCls}
          />
        </label>
        {error ? <p className="text-xs text-[color:var(--danger)]">{error}</p> : null}
      </div>
    </Modal>
  );
}

function ConfirmActionModal({
  type,
  account,
  pending,
  onClose,
  onDone,
}: {
  type: "delete" | "freeze" | "unfreeze";
  account: AdminAccount;
  pending: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const config = {
    delete: { title: "删除账号", desc: `确定删除账号「${account.username}」？此操作不可恢复。`, label: "确认删除" },
    freeze: { title: "冻结账号", desc: `冻结后「${account.username}」将无法登录，已登录会话立即失效。`, label: "确认冻结" },
    unfreeze: { title: "解冻账号", desc: `解冻后「${account.username}」可正常登录。`, label: "确认解冻" },
  }[type];

  const submit = async () => {
    setError(null);
    try {
      if (type === "delete") {
        await deleteAccount(account.id);
        onDone(`已删除账号「${account.username}」。`);
      } else if (type === "freeze") {
        await freezeAccount(account.id);
        onDone(`已冻结账号「${account.username}」。`);
      } else {
        await unfreezeAccount(account.id);
        onDone(`已解冻账号「${account.username}」。`);
      }
    } catch (e) {
      setError(friendlyError(e, "操作失败，请稍后重试。"));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={config.title}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="neu-btn-soft">
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={`neu-btn-primary ${type === "delete" ? "is-danger" : ""}`}
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            {config.label}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-6 text-[color:var(--foreground)]">{config.desc}</p>
        {error ? <p className="text-xs text-[color:var(--danger)]">{error}</p> : null}
      </div>
    </Modal>
  );
}
