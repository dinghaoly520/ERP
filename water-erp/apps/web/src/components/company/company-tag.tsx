"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { api } from "@/lib/api";

/**
 * 公司分组标题 + 公司标签（公司级数据视图，2026-09-17；同日改版：
 * 统计条下线——公司过滤统一走右上角 CompanySelect，列表改为按公司分组展示）。
 *
 * 三页（项目管理/采购进度/采购台账）admin 视图：全部公司=按公司分组、
 * 每组一个 CompanySectionHeader（主标题组件）+ 组内条目；选择某公司=
 * 仍显示该公司标题（useCompanyName 由 companyId 解析名称）。
 *
 * 公司识别色（2026-09-17 用户拍板：每家公司一个可分辨专属色，且公司数会持续增长）：
 *  - 16 色工业协调色板（oklch 等明度/等彩度带），按**注册顺序**（/companies createdAt asc）
 *    顺序分配——老公司色永不变、新公司取下一色、零撞色；超 16 家循环复用色板
 *  - 加载完成前按名称哈希兜底（渲染不空档），列表就绪后自动归位
 *  - 「未归属」固定暖灰（中性色，不占公司色板）
 *  - 色彩只用于识别（色标/计数淡染），不做大底色——保持 impeccable 精密工业基调
 */

/** 公司专属色板（16 色 · 工业协调：明度 0.44–0.72、彩度 0.10–0.15 一致带，环绕色轮） */
const COMPANY_PALETTE = [
  "oklch(0.47 0.12 262)", // 0  藏蓝
  "oklch(0.60 0.15 30)",  // 1  珊瑚
  "oklch(0.58 0.11 195)", // 2  青碧
  "oklch(0.70 0.12 75)",  // 3  琥珀
  "oklch(0.58 0.11 150)", // 4  松绿
  "oklch(0.55 0.13 305)", // 5  靛紫
  "oklch(0.55 0.11 225)", // 6  钢蓝
  "oklch(0.58 0.14 335)", // 7  玫红
  "oklch(0.68 0.11 115)", // 8  橄榄
  "oklch(0.52 0.13 285)", // 9  靛
  "oklch(0.60 0.11 175)", // 10 苔青
  "oklch(0.72 0.12 85)",  // 11 沙金
  "oklch(0.44 0.11 240)", // 12 石墨蓝
  "oklch(0.70 0.13 55)",  // 13 芥末
  "oklch(0.65 0.10 165)", // 14 青瓷
  "oklch(0.50 0.12 355)", // 15 酒红
] as const;

/** 未归属桶：暖灰（中性色基底，不占公司色板） */
const GRAY_NEUTRAL = "oklch(0.62 0.02 258)";

/** 未归属桶标签（行级与分组共用，保持一致） */
export const NO_COMPANY = "未归属";

/* ── 公司注册表缓存（模块级，全会话一次 /companies）：注册顺序=配色序 ── */
interface CompanyLite {
  id: string;
  name: string;
  shortName?: string | null;
}
let companyRegistry: CompanyLite[] | null = null; // createdAt asc
const registryWaiters = new Set<() => void>();

/** 预热公司注册表（幂等；失败置空表，取色回退哈希） */
function ensureCompanyRegistry(): void {
  if (companyRegistry || typeof window === "undefined") return;
  api
    .get<CompanyLite[]>("/companies") // 后端已按 createdAt asc 返回
    .then((list) => {
      companyRegistry = list;
    })
    .catch(() => {
      companyRegistry = [];
    })
    .finally(() => {
      registryWaiters.forEach((w) => w());
      registryWaiters.clear();
    });
}

/** 公司名 → 专属色：注册顺序优先（零撞色、增量稳定），未就绪/未注册名哈希兜底 */
export function companyColor(name: string): string {
  if (name === NO_COMPANY) return GRAY_NEUTRAL;
  if (companyRegistry) {
    const idx = companyRegistry.findIndex((c) => c.name === name);
    if (idx >= 0) return COMPANY_PALETTE[idx % COMPANY_PALETTE.length];
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return COMPANY_PALETTE[Math.abs(hash) % COMPANY_PALETTE.length];
}

/** 行级公司标签：无归属显示灰色「未归属」；hideWhenMissing=true 时不渲染（单行降噪） */
export function CompanyTag({
  name,
  hideWhenMissing = false,
  className = "",
}: {
  name?: string | null;
  hideWhenMissing?: boolean;
  /** 附加类（如 shrink-0 防被 flex 挤压截断） */
  className?: string;
}) {
  const label = (name ?? "").trim() || NO_COMPANY;
  if (hideWhenMissing && label === NO_COMPANY) return null;
  const color = companyColor(label);
  return (
    <span
      className={`inline-flex max-w-[220px] items-center gap-1 truncate rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold ${className}`}
      style={{ color, backgroundColor: `color-mix(in oklch, ${color} 9%, transparent)` }}
      title={label === NO_COMPANY ? "创建人未归属任何公司，请管理员在账号管理中归位" : label}
    >
      <Building2 size={10} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export interface CompanyCount {
  name: string; // 展示名（未归属 → NO_COMPANY）
  count: number;
}

/** rows 的公司列 → 分组计数（降序；未归属恒排末位） */
export function buildCompanyCounts(rows: Array<{ company?: string | null }>): CompanyCount[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = (r.company ?? "").trim() || NO_COMPANY;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name === NO_COMPANY ? 1 : b.name === NO_COMPANY ? -1 : b.count - a.count || a.name.localeCompare(b.name, "zh"),
    );
}

/** 公司分组主标题：竖色标 + 公司名 + mono 计数 + 右延 hairline（精密工业口径，无阴影） */
export function CompanySectionHeader({
  name,
  count,
  suffix,
}: {
  name: string;
  count: number;
  /** 计数补充说明（如台账分页时「共 N 条」的全量口径注记） */
  suffix?: string;
}) {
  useCompanyPaletteReady(); // 注册序配色就绪后重渲染（哈希兜底 → 专属色）
  const color = companyColor(name);
  return (
    <div
      className="flex items-center gap-2.5"
      title={name === NO_COMPANY ? "创建人未归属公司的条目" : name}
    >
      <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <h3 className="text-[13px] font-bold tracking-[-0.01em] text-[color:var(--foreground)]">{name}</h3>
      <span
        className="shrink-0 font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: `color-mix(in oklch, ${color} 78%, var(--muted-foreground))` }}
      >
        {count} 条{suffix ? ` · ${suffix}` : ""}
      </span>
      <span className="h-px min-w-4 flex-1 bg-[color-mix(in_oklch,var(--muted-foreground)_16%,transparent)]" />
    </div>
  );
}

/** 注册表就绪信号（就绪后 companyColor 从哈希兜底归位到注册序配色，组件自动重渲染） */
export function useCompanyPaletteReady(): boolean {
  const [ready, setReady] = useState(companyRegistry !== null);
  useEffect(() => {
    if (companyRegistry) return;
    let alive = true;
    const wake = () => {
      if (alive) setReady(true);
    };
    registryWaiters.add(wake);
    ensureCompanyRegistry();
    return () => {
      alive = false;
      registryWaiters.delete(wake);
    };
  }, []);
  return ready;
}

/** companyId → 公司名（复用注册表缓存，不重复请求；'all'/未找到 → null） */
export function useCompanyName(companyId: string): string | null {
  const ready = useCompanyPaletteReady();
  return useMemo(
    () =>
      !ready || !companyId || companyId === "all"
        ? null
        : companyRegistry?.find((c) => c.id === companyId)?.name ?? null,
    [ready, companyId],
  );
}
