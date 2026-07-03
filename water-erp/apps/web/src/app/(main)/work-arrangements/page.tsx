"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WorkArrangementsPage } from "@/components/work-arrangements/work-arrangements-page";
import { WorkArrangementsPageChairman } from "@/components/work-arrangements/work-arrangements-page-chairman";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";

function WorkArrangementsRouter() {
  const searchParams = useSearchParams();
  const projectManagementItemId = searchParams.get("projectManagementItemId") ?? "";
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchCurrentUser()
      .then((u) => { if (active) setUser(u); })
      .catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, []);

  if (user === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">加载中...</span>
        </div>
      </div>
    );
  }

  if (user?.username === "Swhi-CGZX-00") {
    return <WorkArrangementsPageChairman initialProjectManagementItemId={projectManagementItemId} />;
  }

  return <WorkArrangementsPage initialProjectManagementItemId={projectManagementItemId} />;
}

export default function WorkArrangementsRoute() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
          <span className="text-sm text-[color:var(--muted-foreground)]">加载中...</span>
        </div>
      </div>
    }>
      <WorkArrangementsRouter />
    </Suspense>
  );
}
