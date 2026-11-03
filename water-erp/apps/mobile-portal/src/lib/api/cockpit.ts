/**
 * 驾驶舱数据四卡后三卡客户端（2026-11-03 数据利用评审）：资源告警 / 项目质效 / 开评标进行时。
 * 形状以 2026-11-03 实测契约为准（见 plans/2026-11-03-mobile-3011-leader-cockpit-upgrade.md）。
 */
import { api } from "../api";

/* ── 资源告警（/alerts/overview）── */
export type AlertsOverview = {
  expiringQualifications: number;
  overloadedExperts: number;
};
export const fetchAlertsOverview = () => api.get<AlertsOverview>("/alerts/overview");

/* ── 项目质效（/performance/metrics，近 1 年口径——与 :3005 PerformancePanel 同源同口径）── */
export type PerformanceMetrics = {
  period: { from: string; to: string };
  projectCount: number;
  contractCount: number;
  avgCycleDays: number | null;
  savingsRate: number | null;
  competitionAvg: number | null;
  objectionRate: number | null;
  acceptanceRate: number | null;
  satisfactionAvg: number | null;
};
export const fetchPerformanceMetrics = () => api.get<PerformanceMetrics>("/performance/metrics");

/* ── 开评标进行时（/bid/projects/dashboard）── */
export type BidLiveProject = {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  stage: string;
  openTime: string | null;
  deadline: string | null;
  supplierCount: number;
  supplierSubmitted: number;
  expertCount: number;
};
export const fetchBidLiveProjects = () => api.get<{ projects: BidLiveProject[] }>("/bid/projects/dashboard");
