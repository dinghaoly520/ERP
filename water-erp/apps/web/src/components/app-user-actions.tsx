"use client";

import { Loader2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";
import { UserCenterPanel } from "@/components/user-center-panel";

type AppUserActionsProps = {
  layout?: "header" | "sidebar";
};

export function AppUserActions({ layout = "header" }: AppUserActionsProps) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [showUserCenter, setShowUserCenter] = useState(false);
  const isSidebar = layout === "sidebar";

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

  const handleOpenUserCenter = () => {
    setShowUserCenter(true);
  };

  const handleCloseUserCenter = () => {
    setShowUserCenter(false);
  };

  if (isSidebar) {
    return (
      <>
        <button
          type="button"
          onClick={handleOpenUserCenter}
          className="interactive-surface flex w-full min-h-[52px] items-center justify-center gap-2 rounded-[16px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.8),rgba(241,246,255,0.72))] px-3.5 py-3 text-sm font-medium text-[color:var(--foreground)] shadow-[0_12px_22px_rgba(69,99,158,0.05)] transition-all duration-200 hover:-translate-y-px"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/76 bg-white/82 text-[color:var(--accent)]">
            <UserRound size={17} strokeWidth={1.9} />
          </span>
          <span className="truncate">{currentUser.username}</span>
        </button>
        {showUserCenter && <UserCenterPanel onClose={handleCloseUserCenter} />}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpenUserCenter}
        className="inline-flex min-h-[48px] items-center gap-3 rounded-[18px] border border-white/68 bg-[linear-gradient(145deg,rgba(255,255,255,0.86),rgba(241,246,255,0.78))] px-4 py-2.5 shadow-[0_14px_28px_rgba(69,99,158,0.06)] transition-all hover:bg-white/90"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/76 bg-white/82 text-[color:var(--accent)]">
          <UserRound size={17} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {currentUser.username}
          </div>
        </div>
      </button>
      {showUserCenter && <UserCenterPanel onClose={handleCloseUserCenter} />}
    </>
  );
}
