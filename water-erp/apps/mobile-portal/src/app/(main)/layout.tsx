"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Crown, LogOut } from "lucide-react";
import { fetchCurrentUser, logout, type AuthUser } from "@/lib/api/auth";
import { AuthProvider } from "@/components/m/auth-context";

/* 导航形态（2026-11-19 用户裁定）：顶部通知钮与底部工具栏删除——水叮当改
 * 右下角悬浮钮（/chat 页自身不显，防自跳）；驾驶舱即登录落地首页 */

/* 角色事实标签（2026-11-18 用户裁定「AI 感太重」：欢迎语抒情句撤销→事实行） */
const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  leader: "领导",
  staff: "工作人员",
  bid_host: "开评标主持人",
  bid_expert: "评审专家",
  supplier: "供应商",
};

/** 墙上时间事实行：`2026-11-18 周三 14:32`（本地时区，30s 步进防分钟边界滞后） */
function wallclock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${wd} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);
  /* 顶部事实行时钟（2026-11-18 用户裁定：LLM 欢迎语撤销，改姓名/角色/实时时间） */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
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
        className="relative z-10 mx-auto w-full max-w-lg flex-1 overflow-y-auto overscroll-contain px-[max(0.875rem,env(safe-area-inset-left))] pb-24 pr-[max(0.875rem,env(safe-area-inset-right))] pt-3.5"
      >
        {/* 欢迎卡——仅 Tab 根页（驾驶舱/水叮当）显示；跳转页（台账/进展/分析板块）不占位
            *  （2026-11-19 用户裁定：跳转的页面中删除欢迎语区） */}
        {pathname === "/dashboard" || pathname === "/chat" ? (
          <div className="neu-card-static mb-3 flex items-center gap-3 rounded-[16px] px-3.5 py-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
              style={{ background: "color-mix(in oklch, var(--gold) 14%, transparent)" }}
            >
              <Crown size={18} strokeWidth={1.5} className="text-[var(--gold)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="min-w-0 truncate text-[18px] font-bold tracking-[-0.01em] text-[var(--foreground)]">
                {user?.displayName ?? ""}
              </div>
              <div className="mt-0.5 truncate text-[14px] tabular-nums text-[var(--muted-foreground)]">
                {user ? `${ROLE_LABELS[user.role] ?? user.role} · ${wallclock(now)}` : ""}
              </div>
            </div>
          </div>
        ) : null}
        <AuthProvider user={user}>{children}</AuthProvider>
      </main>

      {/* 水叮当悬浮钮（2026-11-19 用户裁定：撤底部工具栏改右下角悬浮；/chat 页隐藏） */}
      {!pathname.startsWith("/chat") ? (
        <Link
          href="/chat"
          aria-label="打开水叮当助手"
          className="m-fab active:scale-95"
        >
          <Bot size={22} strokeWidth={1.6} />
        </Link>
      ) : null}
    </div>
  );
}
