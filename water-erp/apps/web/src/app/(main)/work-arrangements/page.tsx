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

  if (user === undefined) return null;

  if (user?.username === "Swhi-CGZX-00") {
    return <WorkArrangementsPageChairman initialProjectManagementItemId={projectManagementItemId} />;
  }

  return <WorkArrangementsPage initialProjectManagementItemId={projectManagementItemId} />;
}

export default function WorkArrangementsRoute() {
  return (
    <Suspense fallback={null}>
      <WorkArrangementsRouter />
    </Suspense>
  );
}
