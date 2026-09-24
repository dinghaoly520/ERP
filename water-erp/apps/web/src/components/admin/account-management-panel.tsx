"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import {
  Ban,
  Building2,
  CircleCheck,
  Eye,
  EyeOff,
  KeyRound,
  Fingerprint,
  LogOut,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Trash2,
  UserCog,
  Search,
  AlertTriangle,
} from "lucide-react";
import { Modal } from "@/components/workbench";
import { ApiError } from "@/lib/api";
import { fetchCurrentUser, type AuthRole } from "@/lib/api/auth";
import { RegistrationReviewPanel } from "@/components/admin/registration-review-panel";
import { UnitSearchSelect } from "@/components/login/unit-search-select";
import { PasswordRequestsPanel } from "@/components/admin/password-requests-panel";
import { ROLE_LABELS } from "@/lib/role-labels";
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  fetchCompanyOptions,
  fetchPendingSummary,
  fetchSupplierAccounts,
  freezeAccount,
  revealAccountPassword,
  resetAccountPassword,
  unfreezeAccount,
  updateAccount,
  updateSupplierCompany,
  type AdminAccount,
  type CompanyOption,
  type SupplierAccount,
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
  // 2026-09-14：账号列表双分区——工作人员（审批管理，保留现状）/ 供应商（只读 + 密码查看 + 归属调整）
  const [listView, setListView] = useState<"staff" | "supplier">("staff");
  const [suppliers, setSuppliers] = useState<SupplierAccount[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string | null>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

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
      // 供应商视图数据（失败不阻断工作人员列表）
      const [supplierRows, companyRows] = await Promise.all([
        fetchSupplierAccounts().catch(() => [] as SupplierAccount[]),
        fetchCompanyOptions().catch(() => [] as CompanyOption[]),
      ]);
      setSuppliers(supplierRows);
      setCompanies(companyRows);
    } catch (error) {
      setErrorMessage(friendlyError(error, "加载账号列表失败。"));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadAccounts().finally(() => setLoading(false));
  }, [loadAccounts]);

  // 待审批汇总（红标数据源）：登录态确认后拉取，审批动作后 refresh() 重拉
  const [pending, setPending] = useState({ registrations: 0, passwordChanges: 0, passwordResets: 0, profileChanges: 0, total: 0 });
  const loadPending = useCallback(() => {
    fetchPendingSummary().then(setPending).catch(() => {});
  }, []);
  useEffect(() => { if (currentUser === "admin") loadPending(); }, [currentUser, loadPending]);

  const refresh = () => {
    setActionMessage(null);
    startTransition(async () => {
      await loadAccounts();
      loadPending();
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

  // 未归属巡检（2026-09-17）：公司隔离引擎读 User.companyId，按 company 文本分组会漏掉
  // 「有公司名但无 companyId」的坏数据——此处按 id 计数，>0 时在工作人员分区头亮警示。
  const unassignedCount = accounts.filter((a) => !a.companyId).length;

  // 按公司分组（工作人员：User.company；供应商：Supplier.companyName；未归属沉底）
  const groupBy = <T,>(rows: T[], keyOf: (row: T) => string) =>
    Object.entries(
      rows.reduce<Record<string, T[]>>((acc, row) => {
        const key = keyOf(row).trim() || "未归属";
        (acc[key] ??= []).push(row);
        return acc;
      }, {}),
    ).sort((x, y) => {
      if (x[0] === "未归属") return 1;
      if (y[0] === "未归属") return -1;
      return x[0].localeCompare(y[0]);
    });
  const staffGroups = groupBy(filtered, (a) => a.company ?? "");

  const supplierFiltered = suppliers.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (s.supplier?.name ?? "").toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q)
    );
  });
  const supplierGroups = groupBy(supplierFiltered, (s) => s.supplier?.companyName ?? "");

  const toggleReveal = async (id: string) => {
    if (revealed[id] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealingId(id);
    try {
      const r = await revealAccountPassword(id);
      setRevealed((prev) => ({ ...prev, [id]: r.password }));
      if (r.password === null) {
        setActionMessage("该账号没有可查看的密码副本（改密早于本功能或非供应商账号），下次改密后可查看。");
      }
    } catch (error) {
      setErrorMessage(friendlyError(error, "获取密码失败。"));
    } finally {
      setRevealingId(null);
    }
  };

  const changeSupplierCompany = async (id: string, companyId: string) => {
    try {
      await updateSupplierCompany(id, companyId);
      setSuppliers((prev) =>
        prev.map((s) =>
          s.id === id && s.supplier
            ? { ...s, supplier: { ...s.supplier, companyId, companyName: companies.find((c) => c.id === companyId)?.name ?? null } }
            : s,
        ),
      );
      setActionMessage("归属公司已调整。");
    } catch (error) {
      setErrorMessage(friendlyError(error, "调整归属公司失败。"));
    }
  };

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
              <div className="flex items-center gap-2">
                <div className="page-hero__title">账号管理</div>
                {pending.total > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]" style={{ background: "color-mix(in oklch, var(--danger) 9%, transparent)" }}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--danger)]" />
                    {pending.total} 项待审
                  </span>
                )}
              </div>
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
            {tab === "list" && listView === "staff" ? (
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
              <PendingBadge count={pending.registrations} />
            </button>
            <button type="button" role="tab" aria-selected={tab === "password"} className={`page-tab ${tab === "password" ? "is-active" : ""}`} onClick={() => setTab("password")}>
              <KeyRound size={13} strokeWidth={1.9} />
              安全审批
              <PendingBadge count={pending.passwordChanges + pending.passwordResets + pending.profileChanges} />
            </button>
          </div>
          {/* 列表 tab 显示搜索框；其他 tab 等高占位（二级分区切换已下移到列表上方独立一层） */}
          {tab === "list" ? (
            <div className="relative mb-1.5 w-[280px] shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索用户名 / 姓名 / 公司"
                aria-label="搜索账号"
                className="neu-input neu-input-sm !pl-9 w-full text-sm"
              />
            </div>
          ) : (
            <div aria-hidden className="mb-1.5 h-9 w-[280px] shrink-0" />
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

      {/* 二级分区层（仅「账号列表」tab）：工作人员=审批管理 / 供应商=只读+密码查看 —— 与页面级 tab 分层 */}
      {tab === "list" && (
        <div className="flex items-center justify-between gap-3">
          <div
            className="neu-segment w-full max-w-[320px]"
            role="group"
            aria-label="账号分区"
            data-index={listView === "supplier" ? "1" : "0"}
          >
            <span aria-hidden className="neu-segment-thumb" />
            <button
              type="button"
              aria-pressed={listView === "staff"}
              onClick={() => setListView("staff")}
              className="neu-segment-btn"
            >
              <UserCog size={13} strokeWidth={1.9} />
              工作人员账号
              <span className="neu-segment-count">{accounts.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={listView === "supplier"}
              onClick={() => setListView("supplier")}
              className="neu-segment-btn"
            >
              <Building2 size={13} strokeWidth={1.9} />
              供应商账号
              <span className="neu-segment-count">{suppliers.length}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-[color:var(--muted-foreground)]">
              {listView === "staff" ? "采购中心工作人员账号 · 审批管理" : "各公司供应商账号 · 只读视图"}
            </p>
            {listView === "staff" && unassignedCount > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]"
                style={{ backgroundColor: "color-mix(in oklch, var(--warning) 10%, transparent)" }}
                title="这些账号缺少 companyId，公司级数据隔离下其数据默认不可见——请在「修改」中补填公司以归位"
              >
                <AlertTriangle size={10} strokeWidth={2.2} />
                {unassignedCount} 个账号未归属公司
              </span>
            )}
          </div>
        </div>
      )}

      {/* 列表（工作人员：审批管理，保留现状；供应商：只读视图） */}
      {listView === "staff" ? (
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
              {staffGroups.map(([groupName, rows]) => (
                <Fragment key={groupName}>
                  <tr className="border-b border-white/55 bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]">
                    <td colSpan={6} className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-[color:var(--accent)]">
                      <Building2 size={12} strokeWidth={2} className="mr-1 inline-block align-[-1px]" />
                      {groupName}
                      <span className="ml-1.5 font-normal text-[color:var(--muted-foreground)]">{rows.length} 个账号</span>
                    </td>
                  </tr>
                  {rows.map((account) => {
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
                </Fragment>
              ))}
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
      ) : (
      <div className="overflow-hidden rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,255,0.72))] shadow-[0_12px_28px_rgba(59,89,143,0.06)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/70 text-center text-xs text-[color:var(--muted-foreground)]">
                <th className="px-4 py-3 font-medium">供应商</th>
                <th className="px-4 py-3 font-medium">登录账号（信用代码）</th>
                <th className="px-4 py-3 font-medium">联系人</th>
                <th className="px-4 py-3 font-medium">手机</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">归属公司</th>
                <th className="px-4 py-3 font-medium" style={{ width: 200 }}>密码</th>
              </tr>
            </thead>
            <tbody>
              {supplierGroups.map(([groupName, rows]) => (
                <Fragment key={groupName}>
                  <tr className="border-b border-white/55 bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]">
                    <td colSpan={7} className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-[color:var(--accent)]">
                      <Building2 size={12} strokeWidth={2} className="mr-1 inline-block align-[-1px]" />
                      {groupName}
                      <span className="ml-1.5 font-normal text-[color:var(--muted-foreground)]">{rows.length} 个账号</span>
                    </td>
                  </tr>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-b border-white/55 last:border-0 hover:bg-white/40">
                      <td className="px-4 py-3 text-center font-medium text-[color:var(--foreground)]">
                        {s.supplier?.name ?? s.displayName}
                        {s.supplier?.isTemporary ? (
                          <span className="ml-1.5 rounded-full bg-[rgba(234,179,8,0.12)] px-2 py-0.5 text-[10px] font-semibold leading-none text-[#a16207]">临时</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-xs text-[color:var(--muted-foreground)]">{s.username}</td>
                      <td className="px-4 py-3 text-center text-[color:var(--foreground)]">{s.displayName || "—"}</td>
                      <td className="px-4 py-3 text-center text-[color:var(--muted-foreground)]">{s.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${s.isFrozen ? "bg-[rgba(215,89,89,0.1)] text-[color:var(--danger)]" : s.isActive ? "bg-[rgba(92,181,150,0.12)] text-[#1d7a5f]" : "bg-[rgba(234,179,8,0.12)] text-[#a16207]"}`}>
                          {s.isFrozen ? "已冻结" : s.isActive ? "已激活" : "待审核"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <select
                          value={s.supplier?.companyId ?? ""}
                          onChange={(e) => void changeSupplierCompany(s.id, e.target.value)}
                          className="h-8 max-w-[220px] rounded-[10px] border border-white/60 bg-white/70 px-2 text-xs text-[color:var(--foreground)]"
                          aria-label="调整归属公司"
                        >
                          <option value="" disabled>未归属</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-2 whitespace-nowrap">
                          {revealed[s.id] !== undefined ? (
                            <span className="font-mono text-xs tracking-wide text-[color:var(--foreground)]">{revealed[s.id] ?? "（无副本）"}</span>
                          ) : (
                            <span className="tracking-[2px] text-[color:var(--muted-foreground)]">••••••</span>
                          )}
                          <button
                            type="button"
                            onClick={() => void toggleReveal(s.id)}
                            disabled={revealingId === s.id}
                            className="neu-btn-xs !h-7 !px-2"
                            title={revealed[s.id] !== undefined ? "隐藏密码" : "查看密码"}
                          >
                            {revealingId === s.id ? <Loader2 size={12} className="animate-spin" /> : revealed[s.id] !== undefined ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {supplierFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <span className="command-orb mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(241,245,251,0.88))] text-[var(--muted-foreground)] shadow-[0_10px_22px_rgba(72,120,235,0.06)]">
              <Building2 size={20} strokeWidth={1.6} />
            </span>
            <div className="text-sm font-medium text-[color:var(--foreground)]">没有匹配的供应商账号</div>
            <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">供应商在供应商门户注册后出现在此处</div>
          </div>
        ) : null}
      </div>
      )}

      {/* 新增 / 编辑表单 */}
      {formState ? (
        <AccountFormModal
          mode={formState.mode}
          account={formState.mode === "edit" ? formState.account : undefined}
          companies={companies}
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
  companies,
  pending,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  account?: AdminAccount;
  companies: CompanyOption[];
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
    }
    // 姓名 / 公司必填（2026-09-14）：新建与编辑统一
    if (!displayName.trim()) return setError("请输入姓名");
    if (!company.trim()) return setError("请选择公司");
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
              姓名 <span className="text-[color:var(--danger)]">*</span>
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
              <div
                className="neu-segment"
                role="group"
                aria-label="申请权限"
                data-index={permission === "office" ? "1" : "0"}
              >
                <span aria-hidden className="neu-segment-thumb" />
                {PERMISSION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={permission === opt.value}
                    onClick={() => setPermission(opt.value as "management" | "office")}
                    className="neu-segment-btn"
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
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
              公司 <span className="text-[color:var(--danger)]">*</span>
            </span>
            <UnitSearchSelect
              value={company}
              onChange={setCompany}
              placeholder="请选择公司"
            />
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
  // 2026-09-14：改密窗口显示原密码（passwordVault 解密；无副本=本功能上线前的旧密码）
  const [currentPassword, setCurrentPassword] = useState<string | null>(null);
  const [currentLoading, setCurrentLoading] = useState(true);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    let alive = true;
    revealAccountPassword(account.id)
      .then((r) => { if (alive) setCurrentPassword(r.password); })
      .catch(() => { if (alive) setCurrentPassword(null); })
      .finally(() => { if (alive) setCurrentLoading(false); });
    return () => { alive = false; };
  }, [account.id]);

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
      title={
        <span className="flex items-center gap-2">
          <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]">
            <KeyRound size={14} strokeWidth={1.9} className="text-[var(--accent)]" />
          </span>
          修改密码
        </span>
      }
      description={
        <span>
          账号 <span className="font-mono font-semibold text-[color:var(--foreground)]">{account.username}</span>
          {account.displayName ? ` · ${account.displayName}` : ""}
        </span>
      }
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="neu-btn-soft !h-9 !text-xs">
            取消
          </button>
          <button type="button" onClick={submit} disabled={pending} className="neu-btn-soft !h-9 !text-xs">
            {pending ? <Loader2 size={13} className="animate-spin" /> : null}
            确认修改
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 原密码：内凹展示盒（carved，与代码块同语言）+ 显隐切换 */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted-foreground)]">
            原密码（密码副本解密）
          </span>
          <div className="neu-pre flex items-center gap-2.5 rounded-[10px] px-3 py-2.5">
            <Fingerprint size={14} strokeWidth={1.9} className="shrink-0 text-[color:var(--muted-foreground)]" />
            {currentLoading ? (
              <span className="flex flex-1 items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                <Loader2 size={12} className="animate-spin" /> 正在读取密码副本…
              </span>
            ) : currentPassword ? (
              <>
                <span className="flex-1 truncate font-mono text-sm tracking-wider text-[color:var(--foreground)]">
                  {showCurrent ? currentPassword : "••••••••"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="neu-btn-xs !h-7 !px-2"
                  title={showCurrent ? "隐藏原密码" : "显示原密码"}
                >
                  {showCurrent ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}
                </button>
              </>
            ) : (
              <span className="flex-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                无密码副本——该密码经旧审批流程修改或设置于本功能上线前，无法回显；重置一次后即可查看。
              </span>
            )}
          </div>
        </div>
        {/* 新密码：neu-input + 显隐切换 */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted-foreground)]">
            新密码 <span className="text-[color:var(--danger)]">*</span>
          </span>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className={`${inputCls} pr-10 font-mono`}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
              title={showNew ? "隐藏新密码" : "显示新密码"}
            >
              {showNew ? <EyeOff size={13} strokeWidth={1.9} /> : <Eye size={13} strokeWidth={1.9} />}
            </button>
          </div>
        </label>
        {/* 影响面警示条（warning 淡底，与会话吊销语义一致） */}
        <div className="flex items-start gap-2 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2.5">
          <LogOut size={13} strokeWidth={1.9} className="mt-0.5 shrink-0 text-[var(--warning)]" />
          <span className="text-xs leading-5 text-[color:var(--muted-foreground)]">
            确认修改后，该账号<strong className="text-[color:var(--foreground)]">所有已登录会话立即失效</strong>，需用新密码重新登录。
          </span>
        </div>
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


/** 待审红色角标：>0 时红底白字数字，=0 不渲染 */
function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 py-px text-[10px] font-extrabold leading-none text-white"
      style={{ background: "var(--danger)" }}
      aria-label={`${count} 项待审`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
