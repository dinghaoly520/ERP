"use client";

import { History, KeyRound, Loader2, LogOut, Settings, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { fetchCurrentUser, logout, requestPasswordChange, type AuthUser } from "@/lib/api/auth";
import { clearWorkspaceCache } from "@/components/work-arrangements/work-arrangements-page";
import { fetchMyActivities, AUDIT_ACTION_LABELS, type AuditLogItem } from "@/lib/api/audit-log";
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from "@/lib/api/user-settings";
import { useUserSettings } from "@/lib/user-settings-context";

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  leader: "领导",
  staff: "员工",
};

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "未知";
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "未知";
  }
}

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "从未登录";
  try {
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "未知";
  }
}

function formatShortDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "未知";
  try {
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "未知";
  }
}

type Section = "main" | "password" | "activity" | "settings";

export function ProfilePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [section, setSection] = useState<Section>("main");

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Activity log
  const [activities, setActivities] = useState<AuditLogItem[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Settings
  const { settings: userSettings, loading: loadingSettings, updateSettings } = useUserSettings();
  const [savingSettings, setSavingSettings] = useState(false);
  const [localSettingsError, setLocalSettingsError] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await fetchCurrentUser();
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      } finally {
        setLoadingUser(false);
      }
    };
    void loadUser();
  }, []);

  useEffect(() => {
    if (section === "activity" && currentUser) {
      const loadActivities = async () => {
        setLoadingActivities(true);
        try {
          const result = await fetchMyActivities({ limit: 20 });
          setActivities(result.items);
        } catch {
          setActivities([]);
        } finally {
          setLoadingActivities(false);
        }
      };
      void loadActivities();
    }
  }, [section, currentUser]);

  const handleUpdateSettings = async (updates: Partial<UserSettings>) => {
    if (!userSettings) return;
    setSavingSettings(true);
    setLocalSettingsError(null);
    try {
      await updateSettings(updates);
    } catch {
      setLocalSettingsError("保存设置失败，请稍后重试");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearWorkspaceCache();
      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } finally {
      setLoggingOut(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!currentPassword) { setErrorMessage("请输入当前密码。"); return; }
    if (!newPassword) { setErrorMessage("请输入新密码。"); return; }
    if (!confirmPassword) { setErrorMessage("请再次输入新密码。"); return; }
    if (newPassword.length < 6) { setErrorMessage("新密码至少需要 6 位。"); return; }
    if (newPassword !== confirmPassword) { setErrorMessage("两次输入的新密码不一致。"); return; }

    setSubmitting(true);
    try {
      await requestPasswordChange({ currentPassword, newPassword });
      setSuccessMessage("申请已提交，等待管理员审批通过后，新密码才会生效。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交改密申请失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const resetPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // --- Render: Password change section ---
  if (section === "password") {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setSection("main"); resetPasswordForm(); }}
            className="interactive-surface inline-flex min-h-[40px] items-center gap-2 rounded-[12px] border border-white/60 bg-white/62 px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition-all hover:bg-white/80"
          >
            ← 返回
          </button>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
            修改密码
          </h2>
        </div>

        <form onSubmit={handlePasswordSubmit} noValidate className="max-w-md space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">当前密码</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码"
              className="w-full rounded-[14px] border border-white/70 bg-white/72 px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:bg-white/92"
              autoComplete="current-password"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">新密码</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="请输入不少于 6 位的新密码"
              className="w-full rounded-[14px] border border-white/70 bg-white/72 px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:bg-white/92"
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">确认新密码</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入新密码"
              className="w-full rounded-[14px] border border-white/70 bg-white/72 px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:bg-white/92"
              autoComplete="new-password"
            />
          </label>

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-[14px] border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
              <span className="mt-0.5 shrink-0">⚠</span>
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="flex items-start gap-2 rounded-[14px] border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--success)]">
              <span className="mt-0.5 shrink-0">✓</span>
              {successMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] border border-[color:var(--accent)] bg-[color:var(--accent)] px-6 py-3 text-sm font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (<><Loader2 size={16} className="animate-spin" />提交中</>) : "提交审批"}
          </button>
        </form>
      </div>
    );
  }

  // --- Render: Activity log section ---
  if (section === "activity") {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSection("main")}
            className="interactive-surface inline-flex min-h-[40px] items-center gap-2 rounded-[12px] border border-white/60 bg-white/62 px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition-all hover:bg-white/80"
          >
            ← 返回
          </button>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
            操作记录
          </h2>
        </div>

        {loadingActivities ? (
          <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            正在加载操作记录...
          </div>
        ) : activities.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
            暂无操作记录
          </div>
        ) : (
          <div className="max-w-2xl space-y-2">
            {activities.map((item) => (
              <div key={item.id} className="rounded-[14px] border border-white/60 bg-white/46 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-[color:var(--foreground)]">
                    {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {formatShortDateTime(item.createdAt)}
                  </div>
                </div>
                {item.details && Object.keys(item.details).length > 0 && (
                  <div className="mt-1.5 text-xs text-[color:var(--muted-foreground)]">
                    {item.resourceType}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Render: Settings section ---
  if (section === "settings") {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSection("main")}
            className="interactive-surface inline-flex min-h-[40px] items-center gap-2 rounded-[12px] border border-white/60 bg-white/62 px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition-all hover:bg-white/80"
          >
            ← 返回
          </button>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
            个人设置
          </h2>
        </div>

        {loadingSettings ? (
          <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
            <Loader2 size={16} className="animate-spin" />
            正在加载设置...
          </div>
        ) : userSettings ? (
          <div className="max-w-md space-y-4">
            {localSettingsError && (
              <div className="flex items-start gap-2 rounded-[14px] border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
                <span className="mt-0.5 shrink-0">⚠</span>
                {localSettingsError}
              </div>
            )}

            <div className="rounded-[14px] border border-white/60 bg-white/46 p-4">
              <div className="mb-2.5 text-sm font-medium text-[color:var(--foreground)]">主题</div>
              <div className="flex gap-2">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleUpdateSettings({ theme: option.value })}
                    disabled={savingSettings}
                    className={[
                      "flex-1 rounded-[12px] border px-4 py-2.5 text-sm transition-all",
                      userSettings.theme === option.value
                        ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                        : "border-white/60 bg-white/60 text-[color:var(--muted-foreground)] hover:bg-white/80",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[14px] border border-white/60 bg-white/46 p-4">
              <div className="mb-2.5 text-sm font-medium text-[color:var(--foreground)]">默认首页</div>
              <select
                value={userSettings.defaultHomePage}
                onChange={(e) => handleUpdateSettings({ defaultHomePage: e.target.value as UserSettings["defaultHomePage"] })}
                disabled={savingSettings}
                className="w-full rounded-[12px] border border-white/60 bg-white/70 px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]"
              >
                {HOME_PAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="rounded-[14px] border border-white/60 bg-white/46 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[color:var(--foreground)]">紧凑模式</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">减少界面间距，显示更多内容</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpdateSettings({ compactMode: !userSettings.compactMode })}
                  disabled={savingSettings}
                  className={[
                    "relative h-6 w-11 rounded-full transition-all",
                    userSettings.compactMode ? "bg-[color:var(--accent)]" : "bg-gray-200",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      userSettings.compactMode ? "translate-x-5" : "",
                    ].join(" ")}
                  />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[200px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
            无法加载设置
          </div>
        )}
      </div>
    );
  }

  // --- Render: Main profile view ---
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* User info card */}
      {loadingUser ? (
        <div className="flex min-h-[100px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />
          正在加载账号信息...
        </div>
      ) : currentUser ? (
        <>
          <div className="overflow-hidden rounded-[20px] border border-white/72 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(242,247,255,0.8))] p-5 shadow-[0_16px_34px_rgba(63,96,156,0.06)]">
            <div className="flex items-center gap-4">
              <span className="command-orb inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] border border-white/76 bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(238,244,255,0.82))] text-[color:var(--accent)] shadow-[0_10px_22px_rgba(72,120,235,0.08)]">
                <UserRound size={22} strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:rgba(85,110,155,0.68)]">当前账号</div>
                <div className="text-[1.1rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">{currentUser.username}</div>
                <div className="text-sm text-[color:var(--muted-foreground)]">{currentUser.displayName}</div>
              </div>
            </div>

            <div className="mt-4 space-y-2.5 rounded-[16px] border border-white/60 bg-white/46 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[color:var(--muted-foreground)]">角色</span>
                <span className="text-sm font-semibold text-[color:var(--foreground)]">
                  {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                </span>
              </div>
              <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[color:var(--muted-foreground)]">账号创建时间</span>
                <span className="text-sm font-medium text-[color:var(--foreground)]">{formatDate(currentUser.createdAt)}</span>
              </div>
              <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[color:var(--muted-foreground)]">最后登录时间</span>
                <span className="text-sm font-medium text-[color:var(--foreground)]">{formatDateTime(currentUser.lastLoginAt)}</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => setSection("activity")}
              className="interactive-surface inline-flex min-h-[52px] w-full items-center gap-3 rounded-[16px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.8),rgba(241,246,255,0.72))] px-5 py-4 text-sm font-medium text-[color:var(--foreground)] shadow-[0_10px_20px_rgba(69,99,158,0.05)] transition-all duration-200 hover:-translate-y-px"
            >
              <History size={18} strokeWidth={1.9} className="text-[color:var(--accent)]" />
              操作记录
            </button>

            <button
              type="button"
              onClick={() => setSection("settings")}
              className="interactive-surface inline-flex min-h-[52px] w-full items-center gap-3 rounded-[16px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.8),rgba(241,246,255,0.72))] px-5 py-4 text-sm font-medium text-[color:var(--foreground)] shadow-[0_10px_20px_rgba(69,99,158,0.05)] transition-all duration-200 hover:-translate-y-px"
            >
              <Settings size={18} strokeWidth={1.9} className="text-[color:var(--accent)]" />
              个人设置
            </button>

            <button
              type="button"
              onClick={() => setSection("password")}
              className="interactive-surface inline-flex min-h-[52px] w-full items-center gap-3 rounded-[16px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.8),rgba(241,246,255,0.72))] px-5 py-4 text-sm font-medium text-[color:var(--foreground)] shadow-[0_10px_20px_rgba(69,99,158,0.05)] transition-all duration-200 hover:-translate-y-px"
            >
              <KeyRound size={18} strokeWidth={1.9} className="text-[color:var(--accent)]" />
              修改密码
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="interactive-surface inline-flex min-h-[52px] w-full items-center gap-3 rounded-[16px] border border-[rgba(215,89,89,0.16)] bg-[rgba(255,244,244,0.8)] px-5 py-4 text-sm font-medium text-[color:var(--danger)] shadow-[0_10px_20px_rgba(151,87,87,0.04)] transition-all duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} strokeWidth={1.9} />}
              退出登录
            </button>
          </div>
        </>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          无法加载账号信息
        </div>
      )}
    </div>
  );
}
