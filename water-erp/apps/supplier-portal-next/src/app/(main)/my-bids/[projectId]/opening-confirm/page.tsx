"use client";

// 旧入口兼容：开标确认已并入「在线开标大厅」页（唱标记录查看/确认/异议全在 opening-hall）
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function OpeningConfirmPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/my-bids/${params.projectId}/opening-hall`);
  }, [params.projectId, router]);

  return <div style={{ padding: 40, textAlign: "center", color: "#909399" }}>正在进入在线开标大厅…</div>;
}
