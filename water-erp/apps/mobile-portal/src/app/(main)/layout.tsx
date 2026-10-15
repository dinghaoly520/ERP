"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { FolderKanban, LayoutDashboard, LogOut, TrendingUp } from "lucide-react";
import { fetchCurrentUser, logout, type AuthUser } from "@/lib/api/auth";
import { AuthProvider } from "@/components/m/auth-context";

const TABS = [
  { href: "/dashboard", label: "数据库", icon: LayoutDashboard },
  { href: "/ledger", label: "台账", icon: FolderKanban },
  { href: "/progress", label: "进展", icon: TrendingUp },
];

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

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

  if (!checked) {
    return (
      <div className="flow-page flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_oklch,var(--accent)_30%,transparent)] border-t-[var(--accent)]" />
          <span className="text-[15px] text-[var(--muted-foreground)]">验证登录状态...</span>
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
      <header className="z-40 flex h-14 shrink-0 items-center gap-2.5 border-b border-[color-mix(in_oklch,var(--border)_60%,transparent)] bg-[color-mix(in_oklch,var(--background)_86%,transparent)] pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))] backdrop-blur-md">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(238,244,255,0.86))] shadow-[0_8px_20px_rgba(69,99,158,0.16)]">
          <Image src="/procurement-brand-logo.png" alt="蜀水云采" width={32} height={32} className="rounded-[8px] object-cover" priority />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[12px] font-semibold tracking-[0.06em] text-[var(--muted-foreground)]">蜀水云采 · 专属驾驶舱</div>
          <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[14px] font-medium tracking-[0.1em] text-[var(--gold)]">尊敬的</span>
            <span className="truncate text-[16px] font-bold text-[var(--foreground)]">{user?.displayName ?? ""}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          aria-label="退出登录"
          className="neu-btn-soft h-9 w-9 shrink-0 rounded-[11px] p-0 active:scale-95"
        >
          <LogOut size={15} />
        </button>
      </header>

      <main
        id="m-app-scroll"
        className="relative z-10 mx-auto w-full max-w-lg flex-1 overflow-y-auto overscroll-contain px-[max(0.875rem,env(safe-area-inset-left))] pb-4 pr-[max(0.875rem,env(safe-area-inset-right))] pt-3.5"
      >
        <AuthProvider user={user}>{children}</AuthProvider>
      </main>

      <nav className="m-tabbar" aria-label="主导航">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} data-active={pathname.startsWith(href)} className="m-tab-item">
            <Icon size={20} strokeWidth={1.5} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
