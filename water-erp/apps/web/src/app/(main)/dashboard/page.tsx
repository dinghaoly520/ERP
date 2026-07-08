"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardHome } from "@/components/home/dashboard-home";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";
import { canAccessDatabase } from "@/lib/login/login-routing";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const currentUser = await fetchCurrentUser();
        if (cancelled) return;

        if (!canAccessDatabase(currentUser.role)) {
          router.replace("/procurements");
          return;
        }

        setUser(currentUser);
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Show loading spinner while verifying session
  if (user === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">验证登录状态...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;
  return <DashboardHome currentUserRole={user.role} />;
}
