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
      <header className="z-40 shrink-0 border-b border-[color-mix(in_oklch,var(--border)_60%,transparent)] bg-[color-mix(in_oklch,var(--background)_86%,transparent)] pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))] pt-2 pb-2.5 backdrop-blur-md">
        {/* 行 1：品牌行——logo + 系统名 + 退出 */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(238,244,255,0.86))] shadow-[0_8px_20px_rgba(69,99,158,0.16)]">
            <Image src="/procurement-brand-logo.png" alt="蜀水云采" width={28} height={28} className="rounded-[7px] object-cover" priority />
          </div>
          <div className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[0.02em] text-[var(--foreground)]">蜀水云采 · 专属驾驶舱</div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="退出登录"
            className="neu-btn-soft h-8 w-8 shrink-0 rounded-[10px] p-0 active:scale-95"
          >
            <LogOut size={14} />
          </button>
        </div>
        {/* 行 2：问候行——独占整宽（与系统名文字左对齐），金色敬语 + 大号姓名 */}
        <div className="mt-1.5 flex items-baseline gap-2 pl-[2.75rem]">
          <span className="shrink-0 text-[13px] font-medium text-[var(--gold)]">尊敬的</span>
          <span className="min-w-0 truncate text-[17px] font-bold tracking-[-0.01em] text-[var(--foreground)]">{user?.displayName ?? ""}</span>
        </div>
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
