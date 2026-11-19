"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ANALYSIS_TILES, DashboardHome, type AnalysisTileKey } from "../../dashboard/page";

/* 九板块页面化（2026-11-19 用户裁定：页面呈现替代窗口）：七分析板块走本路由，
 * 套壳复用驾驶舱主组件 panel 模式（口径选择器+板块内容+下钻弹层）；
 * 台账明细/项目进展为独立整页（/ledger、/progress），不经本路由。 */
const PAGE_KEYS = new Set<AnalysisTileKey>(["trend", "ranking", "composition", "company", "risk", "supplier", "experts"]);

export default function AnalysisPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const key = params?.key as AnalysisTileKey;
  const tile = ANALYSIS_TILES.find((t) => t.key === key);
  if (!tile || !PAGE_KEYS.has(key)) {
    router.replace("/dashboard"); // 无效板块回驾驶舱（Hook 已全部调用，早退安全）
    return null;
  }
  return (
    <div>
      {/* 页头：返回驾驶舱 + 板块标题（=宫格卡片标题） */}
      <div className="m-pagebar mb-3 flex items-center gap-2.5 px-3 py-2">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          aria-label="返回驾驶舱"
          className="neu-btn-soft h-9 w-9 shrink-0 rounded-[11px] p-0 active:scale-95"
        >
          <ArrowLeft size={15} />
        </button>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: `color-mix(in oklch, ${tile.color} 12%, transparent)`, color: tile.color }}
        >
          <tile.icon size={16} strokeWidth={1.5} />
        </span>
        <span className="text-[17px] font-bold tracking-[-0.02em] text-[var(--foreground)]">{tile.label}</span>
      </div>
      <DashboardHome panel={key} />
    </div>
  );
}
