"use client";

import { useEffect, useState } from "react";
import { Clock, Timer, CircleX } from "lucide-react";

/**
 * 投递截止倒计时 — 移植自 Vue CountdownTimer.vue。
 * urgency：normal（>24h）/ urgent（<24h）/ critical（<1h，图标脉冲）/ expired（已截止）。
 * 样式 .sp-countdown / .pulse-icon 已在 globals.css。
 */
export function CountdownTimer({ deadline }: { deadline: string | Date }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const diff = new Date(deadline).getTime() - now;
  const isExpired = diff <= 0;

  let display = "已截止";
  if (!isExpired) {
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (days > 0) display = `${days}天 ${hours}时 ${mins}分`;
    else if (hours > 0) display = `${hours}时 ${mins}分 ${secs}秒`;
    else display = `${mins}分 ${secs}秒`;
  }

  const urgency = isExpired ? "expired" : diff / 3600000 < 1 ? "critical" : diff / 3600000 < 24 ? "urgent" : "normal";

  return (
    <span className={`sp-countdown ${urgency}`}>
      {urgency === "expired" ? (
        <CircleX size={13} />
      ) : urgency === "critical" ? (
        <Timer size={13} className="pulse-icon" />
      ) : (
        <Clock size={13} />
      )}
      {display}
    </span>
  );
}
