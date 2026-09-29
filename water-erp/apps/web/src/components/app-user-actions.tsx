"use client";

import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";
import { fetchMyPendingReviewCount } from "@/lib/api/supplier";

type AppUserActionsProps = {
  layout?: "header" | "sidebar";
};

/** 供应商审批中心右上角按钮（2026-09-29 三级审批）：仅内部审批角色可见，角标=待我审数（30s 轮询）。
 *  被 UnifiedHeader（页面顶栏常驻）与 AppUserActions（窄屏 page-header）两处复用。 */
export function ReviewCenterButton({ className }: { className?: string }) {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);

  // 常驻渲染于 UnifiedHeader：角色自查（非审批角色不显示；bid_host/mall 等）
  useEffect(() => {
    fetchCurrentUser().then(u => setMyRole(u?.role ?? null)).catch(() => setMyRole(null));
  }, []);

  const refresh = useCallback(() => {
    fetchMyPendingReviewCount()
      .then((c) => setCount((c.registration ?? 0) + (c.changes ?? 0)))
      .catch(() => setCount(null));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh]);

  if (myRole !== 'admin' && myRole !== 'leader' && myRole !== 'staff') return null;

  return (
    <button
      type="button"
      onClick={() => router.push("/supplier/approval")}
      title="供应商审批中心（注册三级审核 · 信息更新审批）"
      className={className}
    >
      <BadgeCheck size={16} strokeWidth={2} className="text-[color:var(--accent)]" />
      <span className="hidden sm:inline text-xs font-bold tracking-[-0.01em] text-[color:var(--foreground)]">供应商审批</span>
      {count != null && count > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black leading-none text-white"
          style={{ background: "oklch(0.55 0.19 25)", boxShadow: "0 2px 6px oklch(0.55 0.19 25 / 0.4)" }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

export function AppUserActions({ layout = "header" }: AppUserActionsProps) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const isSidebar = layout === "sidebar";
  const router = useRouter();

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const user = await fetchCurrentUser();
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      } finally {
        setLoadingUser(false);
      }
    };

    void loadCurrentUser();
  }, []);

  if (loadingUser) {
    if (isSidebar) {
      return (
        <div className="flex min-h-[48px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />
        </div>
      );
    }

    return (
      <div className="inline-flex min-h-[48px] items-center gap-2 rounded-[18px] border border-white/60 bg-white/58 px-4 py-2 text-sm text-[color:var(--muted-foreground)] shadow-[0_12px_24px_rgba(69,99,158,0.06)]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  const handleClick = () => {
    router.push('/profile');
  };

  // 审批角色（供应商三级审批 + 信息更新审批的操作者；bid_host/mall 等不显示）
  const canReview = currentUser.role === 'admin' || currentUser.role === 'leader' || currentUser.role === 'staff';

  if (isSidebar) {
    return (
      <div className="flex w-full flex-col gap-2">
        {/* 全局兜底入口：自绘 hero 页（无 UnifiedHeader）也能进审批中心 */}
        {canReview && (
          <ReviewCenterButton className="relative flex w-full min-h-[44px] items-center justify-center gap-2 rounded-[16px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.86),rgba(241,246,255,0.78))] px-3.5 py-2.5 text-sm font-bold text-[color:var(--foreground)] shadow-[0_10px_22px_rgba(69,99,158,0.06)] transition-all duration-200 hover:-translate-y-px" />
        )}
        <button
        type="button"
        onClick={handleClick}
        className="interactive-surface flex w-full min-h-[52px] items-center justify-center gap-2 rounded-[16px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.8),rgba(241,246,255,0.72))] px-3.5 py-3 text-sm font-medium text-[color:var(--foreground)] shadow-[0_12px_22px_rgba(69,99,158,0.05)] transition-all duration-200 hover:-translate-y-px"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/76 bg-white/82 text-[color:var(--accent)]">
          <UserRound size={17} strokeWidth={1.9} />
        </span>
        <span className="truncate">{currentUser.displayName}</span>
      </button>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2.5">
      {canReview && (
        <ReviewCenterButton
          className="relative inline-flex min-h-[44px] items-center gap-2 rounded-[16px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.88),rgba(241,246,255,0.8))] px-3.5 py-2 shadow-[0_10px_22px_rgba(69,99,158,0.07)] transition-all hover:-translate-y-px hover:bg-white/92"
        />
      )}
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-[48px] items-center gap-3 rounded-[18px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.86),rgba(241,246,255,0.78))] px-4 py-2.5 shadow-[0_14px_28px_rgba(69,99,158,0.06)] transition-all hover:bg-white/90"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/76 bg-white/82 text-[color:var(--accent)]">
          <UserRound size={17} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {currentUser.displayName}
          </div>
        </div>
      </button>
    </div>
  );
}
