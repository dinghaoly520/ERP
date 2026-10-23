"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Crown, FolderKanban, LayoutDashboard, LogOut, TrendingUp } from "lucide-react";
import { fetchCurrentUser, logout, type AuthUser } from "@/lib/api/auth";
import { fetchMobileGreeting } from "@/lib/api/ai";
import { fetchDashboardBadges, type DashboardBadges } from "@/lib/api/dashboard";
import { AuthProvider } from "@/components/m/auth-context";

const TABS = [
  { href: "/dashboard", label: "数据库", icon: LayoutDashboard },
  { href: "/ledger", label: "台账", icon: FolderKanban },
  { href: "/progress", label: "进展", icon: TrendingUp },
  { href: "/chat", label: "水叮当", icon: Bot },
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);
  /* 顶部 AI 欢迎语——每次进入/刷新都现场生成新句（无缓存、无静态保底行，2026-10-22 用户裁定） */
  const [greeting, setGreeting] = useState<string | null>(null);
  /* Tab 角标（数据库=异常 / 台账=待处理 / 进展=停滞）——回前台即时重取 */
  const [badges, setBadges] = useState<DashboardBadges | null>(null);

  useEffect(() => {
    let active = true;
    fetchCurrentUser()
      .then((u) => {
        if (active) {
          setUser(u);
          setChecked(true);
        }
      })
      .catch(() => {
        /* on401 已跳登录；此处兜底 */
        if (active) router.replace("/login");
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!checked) return;
    let active = true;
    fetchMobileGreeting()
      .then((r) => {
        if (active && r?.text?.trim()) setGreeting(r.text.trim());
      })
      .catch(() => undefined); // 失败保持空行（无静态保底，2026-10-22 用户裁定）
    return () => {
      active = false;
    };
  }, [checked]);

  useEffect(() => {
    if (!checked) return;
    let active = true;
    const load = () => fetchDashboardBadges().then((b) => { if (active) setBadges(b); }).catch(() => undefined);
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; document.removeEventListener("visibilitychange", onVisible); };
  }, [checked]);

  if (!checked) {
    return (
      <div className="flow-page flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_oklch,var(--accent)_30%,transparent)] border-t-[var(--accent)]" />
          <span className="text-[17px] text-[var(--muted-foreground)]">验证登录状态...</span>
        </div>
      </div>
    );
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="flow-page ambient-grid flex h-dvh flex-col overflow-hidden">
      <div className="flow-glow" aria-hidden />
      <header className="z-40 flex h-11 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklch,var(--border)_60%,transparent)] bg-[color-mix(in_oklch,var(--background)_86%,transparent)] pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))] backdrop-blur-md">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(238,244,255,0.86))] shadow-[0_6px_16px_rgba(69,99,158,0.15)]">
          <Image src="/procurement-brand-logo.png" alt="蜀水云采" width={24} height={24} className="rounded-[6px] object-cover" priority />
        </div>
        <div className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-[0.02em] text-[var(--foreground)]">蜀水云采 · 专属驾驶舱</div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label="退出登录"
          className="neu-btn-soft h-7 w-7 shrink-0 rounded-[9px] p-0 active:scale-95"
        >
          <LogOut size={13} />
        </button>
      </header>

      <main
        id="m-app-scroll"
        className="relative z-10 mx-auto w-full max-w-lg flex-1 overflow-y-auto overscroll-contain px-[max(0.875rem,env(safe-area-inset-left))] pb-4 pr-[max(0.875rem,env(safe-area-inset-right))] pt-3.5"
      >
        {/* 欢迎卡——问候语设计容器（玻璃凸起 + 金色图标井），随内容滚动 */}
        <div className="neu-card-static mb-3 flex items-center gap-3 rounded-[16px] px-3.5 py-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
            style={{ background: "color-mix(in oklch, var(--gold) 14%, transparent)" }}
          >
            <Crown size={18} strokeWidth={1.5} className="text-[var(--gold)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-[15px] font-medium text-[var(--gold)]">尊敬的</span>
              <span className="min-w-0 truncate text-[18px] font-bold tracking-[-0.01em] text-[var(--foreground)]">{user?.displayName ?? ""}</span>
            </div>
            <div className="mt-0.5 min-h-5 truncate text-[14px] text-[var(--muted-foreground)]">{greeting}</div>
          </div>
        </div>
        <AuthProvider user={user}>{children}</AuthProvider>
      </main>

      <nav className="m-tabbar" aria-label="主导航">
        {TABS.map(({ href, label, icon: Icon }) => {
          const badge = href === "/dashboard" ? badges?.abnormalCount : href === "/ledger" ? badges?.pendingCount : href === "/progress" ? badges?.stalledCount : undefined;
          return (
            <Link key={href} href={href} data-active={pathname.startsWith(href)} className="m-tab-item relative">
              <span className="relative">
                <Icon size={20} strokeWidth={1.5} />
                {badge ? <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[11px] font-bold leading-none text-white">{badge > 99 ? "99+" : badge}</span> : null}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
