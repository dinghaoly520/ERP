"use client";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { clockSyncedAt, serverNow, syncServerClock } from "@water-erp/shared";

/**
 * A-98：服务器标准时间动态显示。客户端本地时钟可篡改——本组件锚定 /api/time
 * （syncServerClock 半程 RTT 补偿），秒级刷新；未同步成功前灰点+退化本地时间。
 */
export function ServerClock() {
  const [now, setNow] = useState<Date | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    void syncServerClock().then(() => {
      setSynced(clockSyncedAt() > 0);
      setNow(serverNow());
    });
    setNow(serverNow()); // 首帧即时渲染（未同步=本地时间兜底）
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="sp-clock inline-flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: synced ? "var(--success)" : "var(--muted-foreground)" }}
      />
      服务器标准时间
      <strong className="font-mono">
        {now ? dayjs(now).format("YYYY-MM-DD HH:mm:ss") : "--"}
      </strong>
    </span>
  );
}
