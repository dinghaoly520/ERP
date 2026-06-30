"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, TrendingUp, AlertTriangle, Lightbulb } from "lucide-react";
import {
  type DashboardProfile,
  dashboardProfiles,
  defaultDashboardProfileKey,
  resolveDashboardProfileByRange,
} from "@/lib/mock-dashboard";

type AnalysisResult = {
  overview: string;
  findings: string[];
  risks: string[];
  actions: string[];
};

type AnalysisCacheEntry = {
  signature: string;
  result: AnalysisResult;
  updatedAt: string;
};

const defaultProfile =
  dashboardProfiles.find((item) => item.key === defaultDashboardProfileKey) ??
  dashboardProfiles[0];

const ANALYSIS_CACHE_KEY = "procurement:landing-analysis";
const ANALYSIS_CACHE_MAX_AGE_MS = 1000 * 60 * 20;

const aiGreetings = [
  "今天想先看异常事项，还是预算余量？",
  "试试搜索重点部门、供应商或采购方式。",
  "要不要先看看本周最需要推进的采购事项？",
  "可以直接搜异常项目、节资线索或供应商焦点。",
  "今天这批采购里，先从哪个关键词开始？",
];

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

const paragraphTopics: Array<{ topic: string; keywords: string[] }> = [
  { topic: "qualification", keywords: ["资格审查", "未通过", "流标"] },
  { topic: "competition", keywords: ["竞争", "谈判", "竞标", "采购方式"] },
  { topic: "supplier", keywords: ["供应商", "中标", "集中度", "参与"] },
  { topic: "department", keywords: ["部门", "分院", "设计院", "勘察"] },
  { topic: "archive", keywords: ["归档", "附件", "审查意见", "招标文件"] },
  { topic: "saving", keywords: ["节资", "预算", "金额", "资金"] },
];

function detectTopic(text: string) {
  const matched = paragraphTopics.find((item) =>
    item.keywords.some((keyword) => text.includes(keyword)),
  );

  return matched?.topic ?? text.slice(0, 18);
}

function compactParagraphs(analysis: AnalysisResult | null) {
  if (!analysis) {
    return [];
  }

  const selected: string[] = [];
  const seenTopics = new Set<string>();

  if (analysis.overview) {
    selected.push(analysis.overview);
    seenTopics.add("overview");
  }

  const candidates = [
    ...(analysis.findings ?? []),
    ...(analysis.risks ?? []),
    ...(analysis.actions ?? []),
  ].filter(Boolean);

  for (const item of candidates) {
    const topic = detectTopic(item);

    if (seenTopics.has(topic)) {
      continue;
    }

    selected.push(item);
    seenTopics.add(topic);

    if (selected.length === 4) {
      break;
    }
  }

  return selected;
}

function buildTaggedAnalysis(analysis: AnalysisResult | null) {
  if (!analysis) {
    return [];
  }

  const findings = analysis.findings ?? [];

  const tagged = [
    {
      tag: "综合结论",
      content: analysis.overview,
    },
  ];

  const orderedTags = ["资金角度", "部门角度", "供应商角度", "采购方式角度"];

  for (const tag of orderedTags) {
    const match = findings.find((item) => item.startsWith(`${tag}：`));
    if (match) {
      tagged.push({
        tag,
        content: match.replace(`${tag}：`, "").trim(),
      });
      continue;
    }

    const fallback = findings.find((item) => {
      const topic = detectTopic(item);
      if (tag === "资金角度") return topic === "saving";
      if (tag === "部门角度") return topic === "department";
      if (tag === "供应商角度") return topic === "supplier";
      if (tag === "采购方式角度") return topic === "competition";
      return false;
    });

    if (fallback) {
      tagged.push({
        tag,
        content: fallback,
      });
    }
  }

  return tagged.filter((item) => item.content);
}

function formatUpdatedTime(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function LandingHome() {
  const [profile, setProfile] = useState<DashboardProfile>(defaultProfile);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisUpdatedAt, setAnalysisUpdatedAt] = useState<string | null>(null);
  const [searchGreeting, setSearchGreeting] = useState(aiGreetings[0]);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

  const rangeLabel = `${defaultProfile.start} 至 ${defaultProfile.end}`;
  const fallbackProfile = useMemo(
    () => resolveDashboardProfileByRange(defaultProfile.start, defaultProfile.end),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    const loadDashboard = async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/dashboard?startDate=${defaultProfile.start}&endDate=${defaultProfile.end}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error("dashboard 请求失败");
        }

        const result = (await response.json()) as Omit<
          DashboardProfile,
          "key" | "label" | "start" | "end"
        >;

        setProfile({
          ...fallbackProfile,
          ...result,
          key: defaultProfile.key,
          label: defaultProfile.label,
          start: defaultProfile.start,
          end: defaultProfile.end,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        setProfile(fallbackProfile);
      }
    };

    void loadDashboard();

    return () => controller.abort();
  }, [apiBaseUrl, fallbackProfile]);

  useEffect(() => {
    setSearchGreeting(aiGreetings[Math.floor(Math.random() * aiGreetings.length)]);
  }, []);

  const analysisPayload = useMemo(
    () => ({
      rangeLabel,
      startDate: defaultProfile.start,
      endDate: defaultProfile.end,
      summary: {
        totalCount: profile.summary.totalCount,
        completedCount: profile.summary.completedCount,
        abnormalCount: profile.summary.abnormalCount,
        totalBudget: profile.summary.totalBudgetLabel,
        totalAward: profile.summary.totalAwardLabel,
        totalSavings: profile.summary.totalSavingsLabel,
      },
      trendSeries: profile.trendSeries.map((item) => ({
        label: item.label,
        count: item.count,
        amount: item.amount,
      })),
      departmentStats: profile.departmentStats.map((item) => ({
        name: item.name,
        amount: item.amountLabel,
      })),
      methodStats: profile.methodStats.map((item) => ({
        name: item.name,
        share: `${item.share}%`,
      })),
      attachmentProgress: profile.attachmentProgress.map((item) => ({
        label: item.label,
        rate: `${item.rate}%`,
      })),
      supplierStats: profile.supplierStats.map((item) => ({
        name: item.name,
        participatedCount: item.participatedCount,
        winCount: item.winCount,
        awardAmount: item.awardAmountLabel,
      })),
      resultStats: profile.resultStats.map((item) => ({
        label: item.label,
        count: item.count,
        amount: item.amountLabel,
      })),
      nonAwardReasons: profile.nonAwardReasons.map((item) => ({
        label: item.label,
        count: item.count,
        detail: item.detail,
      })),
      riskProjects: profile.riskProjects.map((item) => ({
        project: item.project,
        department: item.department,
        reason: item.reason,
        pendingDays: item.pendingDays,
        severity: item.severity,
      })),
      quickActions: [] as string[],
    }),
    [profile, rangeLabel],
  );
  const analysisSignature = useMemo(
    () => JSON.stringify(analysisPayload),
    [analysisPayload],
  );

  useEffect(() => {
    const controller = new AbortController();

    const runAnalysis = async () => {
      setAnalysisError(null);
      let hasValidCachedSnapshot = false;

      if (typeof window !== "undefined") {
        try {
          const cachedRaw = window.localStorage.getItem(ANALYSIS_CACHE_KEY);

          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as AnalysisCacheEntry;
            const isMatching = cached.signature === analysisSignature;
            const isFresh =
              new Date(cached.updatedAt).getTime() > Date.now() - ANALYSIS_CACHE_MAX_AGE_MS;

            if (isMatching) {
              setAnalysis(cached.result);
              setAnalysisUpdatedAt(cached.updatedAt);
              hasValidCachedSnapshot = true;

              if (isFresh) {
                return;
              }
            }
          }
        } catch {
          window.localStorage.removeItem(ANALYSIS_CACHE_KEY);
        }
      }

      try {
        const response = await fetch(`${apiBaseUrl}/ai/dashboard-analysis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify(analysisPayload),
        });

        if (!response.ok) {
          throw new Error("AI 分析请求失败");
        }

        const result = (await response.json()) as AnalysisResult;
        const updatedAt = new Date().toISOString();
        setAnalysis(result);
        setAnalysisUpdatedAt(updatedAt);

        if (typeof window !== "undefined") {
          const cacheEntry: AnalysisCacheEntry = {
            signature: analysisSignature,
            result,
            updatedAt,
          };
          window.localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cacheEntry));
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        if (!hasValidCachedSnapshot) {
          setAnalysisError("AI 分析暂时不可用");
        }
      }
    };

    void runAnalysis();

    return () => controller.abort();
  }, [analysisPayload, analysisSignature, apiBaseUrl]);

  const completionRate =
    (profile.summary.completedCount / Math.max(profile.summary.totalCount, 1)) * 100;
  const savingsRate =
    (profile.summary.totalSavings / Math.max(profile.summary.totalBudget, 1)) * 100;
  const dominantMethod = profile.methodStats[0];
  const activeDepartment = profile.departmentStats[0];
  const activeSupplier = [...profile.supplierStats].sort(
    (left, right) => right.participatedCount - left.participatedCount,
  )[0];
  const remainingBudget = Math.max(
    profile.summary.totalBudget - profile.summary.totalAward - profile.summary.totalSavings,
    0,
  );
  const awardedBudgetRate =
    (profile.summary.totalAward / Math.max(profile.summary.totalBudget, 1)) * 100;
  const savingsAmountRate =
    (profile.summary.totalSavings / Math.max(profile.summary.totalBudget, 1)) * 100;
  const remainingBudgetRate =
    (remainingBudget / Math.max(profile.summary.totalBudget, 1)) * 100;
  const pendingCount = Math.max(
    profile.summary.totalCount - profile.summary.completedCount - profile.summary.abnormalCount,
    0,
  );
  const analysisParagraphs = compactParagraphs(analysis);
  const taggedAnalysis = buildTaggedAnalysis(analysis);
  const analysisOverview =
    analysis?.overview || analysisParagraphs[0] || "正在结合当前真实采购数据生成管理判断。";
  const analysisInsights =
    (taggedAnalysis.length > 0
      ? taggedAnalysis
      : analysisParagraphs.map((paragraph, index) => ({
          tag: index === 0 ? "综合结论" : `分析 ${index}`,
          content: paragraph,
        }))
    )
      .slice(0, 4)
      .map((item) => ({
        tag: item.tag,
        content: item.content.replace(/^[^：]+：/, "").trim(),
      }));
  const analysisRisks = (analysis?.risks ?? []).filter(Boolean).slice(0, 2);
  const analysisActions = (analysis?.actions ?? []).filter(Boolean).slice(0, 2);
  const analysisDigest = analysisError
    ? analysisError
    : analysisOverview;
  const analysisDetail =
    analysisActions[0] || analysisRisks[0] || analysisInsights[0]?.content || "等待更多分析结果返回。";
  const formattedAnalysisUpdatedAt = formatUpdatedTime(analysisUpdatedAt);

  return (
    <div className="ambient-grid h-full px-4 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1480px] flex-col">
        <header className="relative flex flex-col gap-3 px-1 py-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(560px,620px)_minmax(0,1fr)] lg:items-center lg:gap-6 lg:px-2 landing-header-float">
          <div className="flex items-center gap-4 lg:justify-self-start">
            <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[rgba(255,255,255,0.34)] landing-logo-enter">
              <Image
                src="/procurement-brand-logo.png"
                alt="智慧水发采购中心"
                width={34}
                height={34}
                className="rounded-[10px] object-cover"
                priority
              />
            </div>
            <div>
              <div className="text-[0.9rem] font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                智慧水发·采购中心
              </div>
            </div>
          </div>

          <label className="group relative mx-auto flex w-full max-w-[560px] items-center gap-3 overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(241,246,255,0.58)_48%,rgba(249,245,235,0.44))] px-4 py-3 shadow-[0_18px_36px_rgba(120,146,195,0.1),inset_0_1px_0_rgba(255,255,255,0.88)] transition-all duration-200 focus-within:shadow-[0_20px_40px_rgba(114,143,198,0.16),inset_0_1px_0_rgba(255,255,255,0.94)] lg:max-w-none lg:justify-self-center landing-search-glow">
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(107,150,238,0.12),transparent_32%),radial-gradient(circle_at_right,rgba(234,188,110,0.1),transparent_26%)] opacity-80 transition-opacity duration-200 group-focus-within:opacity-100" />
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(234,240,252,0.68))] shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
              <Search size={16} className="text-[rgba(96,125,180,0.86)]" />
            </span>
            <div className="relative min-w-0 flex-1 text-left">
            <input
              type="search"
              aria-label="智能搜索"
              placeholder={searchGreeting}
              className="w-full bg-transparent text-base text-[color:var(--foreground)] outline-none placeholder:text-[rgba(120,136,164,0.58)]"
            />
            </div>
          </label>

          <div className="flex items-center gap-3 lg:justify-self-end">
            <button
              type="button"
              aria-label="用户入口"
              className="group relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-[16px] bg-[linear-gradient(145deg,rgba(255,255,255,0.78),rgba(236,242,255,0.58)_58%,rgba(251,245,232,0.44))] shadow-[0_14px_30px_rgba(118,145,196,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] transition-transform duration-200 hover:-translate-y-0.5"
            >
              <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(108,150,238,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(234,188,110,0.14),transparent_30%)]" />
              <span className="relative flex h-7 w-7 items-center justify-center rounded-[11px] bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(232,239,251,0.68))] shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                <span className="absolute inset-x-[4px] inset-y-[4px] rounded-[8px] bg-[rgba(96,139,239,0.1)]" />
                <span className="absolute left-1/2 top-[6px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[rgba(96,139,239,0.9)]" />
                <span className="absolute left-1/2 top-[9px] h-2.5 w-4 -translate-x-1/2 rounded-t-[999px] bg-[rgba(96,139,239,0.82)]" />
                <span className="absolute left-[7px] top-[15px] h-px w-[13px] rounded-full bg-[rgba(96,139,239,0.56)]" />
                <span className="absolute left-[7px] top-[18px] h-px w-[9px] rounded-full bg-[rgba(96,139,239,0.34)]" />
                <span className="absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-[rgba(234,188,110,0.92)] shadow-[0_0_0_2px_rgba(234,188,110,0.12)]" />
              </span>
            </button>

            <Link
              href="/dashboard"
              className="interactive-surface inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-[color:var(--foreground)]"
            >
              进入数据库
            </Link>
          </div>
        </header>

        <main className="relative flex flex-1 flex-col items-center px-1 pb-6 pt-2 lg:px-2 lg:pb-7 lg:pt-3">
          <div className="pointer-events-none absolute left-[8%] top-[10%] h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(104,149,245,0.18),transparent_70%)] blur-3xl animate-[atmosphereFloat_18s_var(--ease-out-quint)_infinite]" />
          <div className="pointer-events-none absolute right-[10%] top-[16%] h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(242,201,132,0.14),transparent_72%)] blur-3xl animate-[atmosphereFloatAlt_22s_var(--ease-out-quint)_infinite]" />
          <div className="pointer-events-none absolute bottom-[12%] left-[50%] h-56 w-56 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(120,209,186,0.12),transparent_72%)] blur-3xl animate-[ambientDrift_16s_var(--ease-out-quint)_infinite]" />

          <section className="mx-auto flex w-full max-w-[1180px] flex-col items-center text-center">
            <div className="flex h-[58px] w-[58px] items-center justify-center rounded-[16px] bg-[rgba(255,255,255,0.28)] lg:h-[62px] lg:w-[62px] landing-logo-enter" style={{ animationDelay: '0.2s' }}>
              <Image
                src="/procurement-brand-logo.png"
                alt="智慧水发采购中心"
                width={70}
                height={70}
                className="rounded-[12px] object-cover lg:h-[48px] lg:w-[48px]"
                priority
              />
            </div>

            <h1 className="mt-4 font-[family-name:var(--font-display)] text-[clamp(2rem,4.2vw,4.1rem)] font-semibold leading-[0.96] tracking-[-0.07em] text-[color:var(--foreground)] landing-title-gradient">
              采购中心办公管理系统
            </h1>

            <div className="relative mt-4 inline-flex max-w-full items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.64),rgba(243,247,255,0.46)_52%,rgba(255,247,233,0.42))] px-4 py-2 shadow-[0_14px_34px_rgba(126,149,192,0.08),inset_0_1px_0_rgba(255,255,255,0.86)] landing-slogan-badge">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(104,149,245,0.12),transparent_30%),radial-gradient(circle_at_right,rgba(234,188,110,0.12),transparent_26%)]" />
              <span className="relative mr-3 hidden h-px w-10 bg-[linear-gradient(90deg,rgba(96,139,239,0),rgba(96,139,239,0.72))] sm:block" />
              <span className="relative hidden h-2 w-2 rounded-full bg-[rgba(96,139,239,0.8)] shadow-[0_0_0_4px_rgba(96,139,239,0.1)] sm:block" />
              <p className="relative px-3 text-[0.84rem] font-medium tracking-[0.24em] text-[rgba(77,94,126,0.92)] sm:text-[0.88rem] lg:text-[0.92rem]">
                坚持原则、坚定立场、坚决执行
              </p>
              <span className="relative hidden h-2 w-2 rounded-full bg-[rgba(234,188,110,0.82)] shadow-[0_0_0_4px_rgba(234,188,110,0.1)] sm:block" />
              <span className="relative ml-3 hidden h-px w-10 bg-[linear-gradient(90deg,rgba(234,188,110,0.72),rgba(234,188,110,0))] sm:block" />
            </div>

            <div className="mt-5 w-full px-1 lg:px-2">
              <div className="rounded-[28px] bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(244,248,255,0.48))] px-4 py-4 shadow-[0_18px_50px_rgba(140,164,205,0.12)] backdrop-blur-xl lg:px-5 lg:py-5 glass-spectrum glass-spectrum-hero">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26px_minmax(0,1fr)_26px_minmax(0,1fr)] xl:items-stretch">
                  <div className="flex h-full flex-col px-2 py-2 landing-metrics-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-left">
                        <div className="text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                          采购事项
                        </div>
                      </div>
                      <div className="flex items-center justify-center">
                        <div className="relative h-[76px] w-[76px]">
                          <svg viewBox="0 0 112 112" className="h-full w-full budget-arc-fill">
                            <circle
                              cx="56"
                              cy="56"
                              r="38"
                              fill="none"
                              stroke="rgba(172,190,222,0.18)"
                              strokeWidth="8"
                            />
                            <circle
                              cx="56"
                              cy="56"
                              r="38"
                              fill="none"
                              stroke="rgba(96,139,239,0.92)"
                              strokeWidth="8"
                              strokeLinecap="round"
                              strokeDasharray={`${completionRate * 2.387} 238.7`}
                              transform="rotate(-90 56 56)"
                              className="budget-arc-fill"
                              style={{ animationDelay: '0.3s' }}
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center budget-percent-text">
                            <div className="text-[8px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              完成率
                            </div>
                            <div className="mt-1 text-[1.16rem] font-semibold tracking-[-0.06em] text-[color:var(--foreground)]">
                              {formatPercent(completionRate)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3 pb-2">
                      <div className="text-left">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                          当前总量
                        </div>
                        <div className="mt-1 text-[clamp(1.32rem,1.7vw,1.86rem)] font-semibold tracking-[-0.06em] text-[color:var(--foreground)]">
                          {profile.summary.totalCount}项
                        </div>
                      </div>
                      <div className="min-w-[180px] flex-1">
                        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                          <span>执行进度</span>
                          <span>{profile.summary.completedCount} / {profile.summary.totalCount}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[rgba(186,204,236,0.18)] landing-progress-shimmer">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(96,139,239,0.92),rgba(126,158,226,0.82))]"
                            style={{ width: `${completionRate}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto grid min-h-[74px] gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                      {[
                        {
                          label: "完成",
                          value: `${profile.summary.completedCount}项`,
                          color: "rgba(96,139,239,0.92)",
                        },
                        {
                          label: "异常",
                          value: `${profile.summary.abnormalCount}项`,
                          color: "rgba(181,137,58,0.88)",
                        },
                        {
                          label: "待推进",
                          value: `${pendingCount}项`,
                          color: "rgba(115,132,164,0.82)",
                        },
                      ].map((item) => (
                        <div key={item.label} className="px-3 py-2 text-left landing-stat-item rounded-[12px] transition-all duration-200">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                            {item.label}
                          </div>
                          <div
                            className="mt-1 text-base font-semibold tracking-[-0.04em]"
                            style={{ color: item.color }}
                          >
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="relative hidden xl:flex items-center justify-center self-stretch">
                    <div className="h-full w-px bg-[linear-gradient(180deg,rgba(123,144,182,0.02),rgba(123,144,182,0.16),rgba(208,176,121,0.14),rgba(208,176,121,0.02))]">
                      <span className="absolute left-1/2 top-[18%] h-16 w-3 -translate-x-1/2 rounded-full bg-[linear-gradient(180deg,rgba(123,144,182,0.1),rgba(208,176,121,0.08))] blur-[3px] animate-[pulse_5.8s_ease-in-out_infinite]" />
                      <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(135,153,188,0.48)] shadow-[0_0_0_6px_rgba(135,153,188,0.05)] animate-[pulse_4.8s_ease-in-out_infinite]" />
                    </div>
                  </div>

                  <div className="flex h-full flex-col px-2 py-2 landing-metrics-card" style={{ animationDelay: '0.3s' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-left">
                        <div className="text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                          预算结构
                        </div>
                      </div>
                      <div className="text-right text-[11px] tracking-[0.08em] text-[color:rgba(90,106,134,0.88)]">
                        节资率 {formatPercent(savingsRate)}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                      <div className="text-left">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                          总预算
                        </div>
                        <div className="mt-1 text-[clamp(1.24rem,1.55vw,1.72rem)] font-semibold tracking-[-0.055em] text-[color:var(--foreground)]">
                          {profile.summary.totalBudgetLabel}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 overflow-hidden rounded-full bg-[rgba(192,205,224,0.16)] landing-progress-shimmer">
                      <div className="flex h-3 w-full">
                        <div
                          className="h-full bg-[linear-gradient(90deg,rgba(112,139,196,0.88),rgba(142,163,206,0.78))]"
                          style={{ width: `${awardedBudgetRate}%` }}
                        />
                        <div
                          className="h-full bg-[linear-gradient(90deg,rgba(188,204,222,0.82),rgba(205,216,230,0.72))]"
                          style={{ width: `${savingsAmountRate}%` }}
                        />
                        <div
                          className="h-full bg-[linear-gradient(90deg,rgba(226,192,131,0.74),rgba(233,210,168,0.5))]"
                          style={{ width: `${remainingBudgetRate}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-auto grid min-h-[74px] gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                      {[
                        {
                          label: "合同",
                          value: profile.summary.totalAwardLabel,
                          ratio: `${Math.round(awardedBudgetRate)}%`,
                          tone: "rgba(96,139,239,0.92)",
                        },
                        {
                          label: "节资",
                          value: profile.summary.totalSavingsLabel,
                          ratio: `${Math.round(savingsAmountRate)}%`,
                          tone: "rgba(156,173,198,0.78)",
                        },
                        {
                          label: "余量",
                          value: `${remainingBudget.toFixed(1)}万`,
                          ratio: `${Math.round(remainingBudgetRate)}%`,
                          tone: "rgba(234,188,110,0.88)",
                        },
                      ].map((item) => (
                        <div key={item.label} className="px-3 py-2 text-left landing-stat-item rounded-[12px] transition-all duration-200">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              {item.label}
                            </div>
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: item.tone }}
                            />
                          </div>
                          <div className="mt-1 text-[0.96rem] font-semibold tracking-[-0.045em] text-[color:var(--foreground)]">
                            {item.value}
                          </div>
                          <div className="mt-1 text-[11px] tracking-[0.06em] text-[color:rgba(90,106,134,0.88)]">
                            占比 {item.ratio}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="relative hidden xl:flex items-center justify-center self-stretch">
                    <div className="h-full w-px bg-[linear-gradient(180deg,rgba(123,144,182,0.02),rgba(123,144,182,0.15),rgba(208,176,121,0.12),rgba(208,176,121,0.02))]">
                      <span className="absolute left-1/2 bottom-[18%] h-16 w-3 -translate-x-1/2 rounded-full bg-[linear-gradient(180deg,rgba(144,168,182,0.08),rgba(208,176,121,0.08))] blur-[3px] animate-[pulse_6.2s_ease-in-out_infinite]" />
                      <span className="absolute left-1/2 top-1/3 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(144,168,182,0.44)] shadow-[0_0_0_6px_rgba(144,168,182,0.05)] animate-[pulse_5.1s_ease-in-out_infinite]" />
                    </div>
                  </div>

                  <div className="flex h-full flex-col px-2 py-2 landing-metrics-card" style={{ animationDelay: '0.45s' }}>
                    <div className="text-left">
                      <div className="text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                        活跃关系
                      </div>
                    </div>

                    <div className="mt-2 flex flex-1 flex-col gap-3">
                      <div className="flex items-center justify-center pt-1">
                        <svg viewBox="0 0 260 44" className="h-8 w-full max-w-[220px]">
                          <circle cx="32" cy="22" r="5.5" fill="rgba(123,145,191,0.82)" />
                          <path
                            d="M 39 22 C 72 22, 72 22, 130 22"
                            stroke="rgba(154,171,196,0.34)"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                            fill="none"
                          />
                          <circle cx="130" cy="22" r="5.5" fill="rgba(109,181,165,0.72)" />
                          <path
                            d="M 137 22 C 176 22, 176 22, 228 22"
                            stroke="rgba(170,183,192,0.3)"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                            fill="none"
                          />
                          <circle cx="228" cy="22" r="5.5" fill="rgba(213,181,126,0.76)" />
                        </svg>
                      </div>

                      <div className="grid min-h-[74px] gap-2 sm:grid-cols-3">
                        <div className="px-3 py-2 text-left">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                            重点部门
                          </div>
                          <div className="mt-1 text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                            {activeDepartment?.name ?? "--"}
                          </div>
                        </div>

                        <div className="px-3 py-2 text-left">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                            供应商焦点
                          </div>
                          <div className="mt-1 text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                            {activeSupplier?.name ?? "--"}
                          </div>
                        </div>

                        <div className="px-3 py-2 text-left">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                            主导方式
                          </div>
                          <div className="mt-1 text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                            {dominantMethod?.name ?? "--"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 w-full px-1 text-left lg:px-2">
              <div className="rounded-[28px] bg-[linear-gradient(180deg,rgba(246,249,255,0.82),rgba(239,244,252,0.54))] px-4 py-4 shadow-[0_18px_54px_rgba(129,151,190,0.14)] backdrop-blur-xl lg:px-5 lg:py-5 glass-spectrum glass-spectrum-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mt-1.5 text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                      智能研判舱
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[rgba(255,255,255,0.56)] px-3 py-1.5 text-[11px] tracking-[0.14em] text-[color:var(--accent)]">
                    <span className="h-2 w-2 rounded-full bg-[rgba(96,139,239,0.92)] shadow-[0_0_0_6px_rgba(96,139,239,0.08)] floating-indicator" />
                    水叮当
                  </div>
                </div>

                <div className="mt-3 pt-3">
                  <div className="rounded-[22px] bg-[linear-gradient(140deg,rgba(255,255,255,0.72),rgba(237,243,255,0.42))] px-4 py-3">
                    <div className="flex items-center justify-end gap-2 text-[11px] tracking-[0.08em] text-[color:rgba(90,106,134,0.88)]">
                      <span>{rangeLabel}</span>
                      {formattedAnalysisUpdatedAt ? <span>更新于 {formattedAnalysisUpdatedAt}</span> : null}
                    </div>

                    {/* Analysis Content - always visible based on content */}
                    <div className="mt-2 space-y-3">
                      {/* Core Insights */}
                      {analysisInsights.length > 0 && (
                        <div className="space-y-1.5">
                          {analysisInsights.map((insight, idx) => (
                            <div
                              key={idx}
                              className="landing-insight-card flex items-start gap-2 rounded-[14px] bg-[rgba(255,255,255,0.6)] px-3 py-2.5"
                            >
                              <Sparkles size={14} className="text-[rgba(96,139,239,0.75)] mt-0.5" />
                              <p className="text-[0.82rem] leading-5 text-[color:var(--foreground)]">
                                {insight.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Risk Alerts */}
                      {analysisRisks.length > 0 && (
                        <div className="space-y-1.5">
                          {analysisRisks.map((risk, idx) => (
                            <div
                              key={idx}
                              className="landing-action-item flex items-center gap-2 rounded-[14px] bg-[rgba(255,247,235,0.56)] px-3 py-2"
                              style={{ animationDelay: `${0.15 + idx * 0.1}s` }}
                            >
                              <AlertTriangle size={14} className="text-[rgba(181,137,58,0.75)]" />
                              <p className="text-[0.82rem] leading-5 text-[color:rgba(78,95,124,0.92)]">{risk}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Suggestions */}
                      {analysisActions.length > 0 && (
                        <div className="space-y-1.5">
                          {analysisActions.map((action, idx) => (
                            <div
                              key={idx}
                              className="landing-action-item flex items-center gap-2 rounded-[14px] bg-[rgba(246,252,250,0.58)] px-3 py-2"
                              style={{ animationDelay: `${0.15 + idx * 0.1}s` }}
                            >
                              <Lightbulb size={14} className="text-[rgba(92,181,150,0.75)]" />
                              <p className="text-[0.82rem] leading-5 text-[color:rgba(78,95,124,0.92)]">{action}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
