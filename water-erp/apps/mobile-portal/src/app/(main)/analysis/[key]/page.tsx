"use client";

import { useParams, useRouter } from "next/navigation";
import { ANALYSIS_TILES, DashboardHome, type AnalysisTileKey } from "../../dashboard/page";
import { PageHeader } from "@/components/m/page-header";

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
      {/* 页头（九页统一版式）：返回贴左、图标井+标题居中 */}
      <PageHeader title={tile.label} icon={tile.icon} color={tile.color} />
      <DashboardHome panel={key} />
    </div>
  );
}
