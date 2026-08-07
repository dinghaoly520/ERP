"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssistantAction, AssistantCard, Message } from "./types";
import { MiniSprite } from "./mini-sprite";
import { ChartRenderer } from "./chart-renderer";
import { BarChart3, X } from "lucide-react";
import type { ReactNode } from "react";

// ---- Markdown 渲染 ----

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1 text-[color:var(--foreground)]">{children}</h3>,
        h3: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 text-[color:var(--foreground)]">{children}</h4>,
        ul: ({ children }) => <ul className="ml-4 list-disc space-y-0.5 text-sm">{children}</ul>,
        ol: ({ children }) => <ol className="ml-4 list-decimal space-y-0.5 text-sm">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        p: ({ children }) => <p className="text-sm leading-relaxed">{children}</p>,
        strong: ({ children }) => <strong>{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        code: CodeRenderer,
        a: ({ href, children }) => (
          <a href={href} className="text-[color:var(--accent)] underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[rgba(120,160,240,0.25)] pl-3 italic text-[color:var(--muted-foreground)] my-1">
            {children}
          </blockquote>
        ),
        hr: () => <div className="h-1.5" />,
        // 防御性降级 — 表格转文本
        table: ({ children }) => (
          <div className="text-xs text-[color:var(--muted-foreground)] py-1 overflow-x-auto">
            {children}
          </div>
        ),
        thead: ({ children }) => <div className="font-semibold">{children}</div>,
        tbody: ({ children }) => <div>{children}</div>,
        tr: ({ children }) => <div className="flex gap-2 border-b border-[rgba(0,0,0,0.04)] py-0.5">{children}</div>,
        th: ({ children }) => <span className="flex-1 text-[10px]">{children}</span>,
        td: ({ children }) => <span className="flex-1 text-[10px]">{children}</span>,
        // 安全: 排除危险元素
        script: () => null,
        iframe: () => null,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function CodeRenderer({ className, children, ...props }: {
  className?: string;
  children?: ReactNode;
  node?: unknown;
  inline?: boolean;
}) {
  // react-markdown 对块级代码传 className="language-xxx"，内联不传 className
  const isInline = !className;
  if (isInline) {
    return (
      <code className="rounded bg-black/5 px-1 py-0.5 text-xs font-mono" {...props}>
        {children}
      </code>
    );
  }
  return (
    <pre className="rounded-xl bg-black/[0.03] border border-[rgba(0,0,0,0.04)] p-3 overflow-x-auto my-1.5">
      <code className="text-xs font-mono whitespace-pre-wrap" {...props}>
        {children}
      </code>
    </pre>
  );
}

// ---- 追问按钮 ----

export function FollowUpButtons({
  items,
  onSend,
}: {
  items: string[];
  onSend: (text: string) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => onSend(item)}
          className="asst-followup"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

// ---- ChatMessage 组件 ----

export function ChatMessage({
  message,
  actions,
  followUps,
  onSendFollowUp,
}: {
  message: Message;
  actions?: AssistantAction[];
  followUps?: string[];
  onSendFollowUp?: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const displayActions = actions ?? (message.actions as AssistantAction[] | undefined);

  const chartActions = isUser
    ? []
    : (displayActions?.filter((a) => a.type === "chart") ?? []);
  const otherActions = displayActions?.filter((a) => a.type !== "chart") ?? [];
  const cards = (message.cards as AssistantCard[]) ?? [];
  // 图表/表格走弹窗，指标卡保持内联（不占空间）
  const richCards = cards.filter((c) => c.type === "chart" || c.type === "table");
  const metricCards = cards.filter((c) => c.type === "metric");
  const hasRich = chartActions.length > 0 || richCards.length > 0;

  const [chartModalOpen, setChartModalOpen] = useState(false);

  return (
    <div className={`asst-message-row ${isUser ? "asst-message-row-user" : ""}`}>
      {/* Avatar */}
      {!isUser && <MiniSprite size={28} animated />}

      <div className={`asst-message-col ${isUser ? "asst-message-col-user" : "asst-message-col-bot"}`}>
        {/* 对话气泡：仅放文字 + 指标卡 + 查看图表按钮 */}
        <div className={`asst-bubble ${isUser ? "asst-bubble-user" : "asst-bubble-bot"}`}>
          {isUser ? message.content : <MarkdownContent content={message.content} />}

          {/* 指标卡保持内联（紧凑） */}
          {!isUser && metricCards.length > 0 && <DataCards cards={metricCards} />}

          {/* 有图表/表格时显示按钮，不直接渲染 */}
          {!isUser && hasRich && (
            <button
              onClick={() => setChartModalOpen(true)}
              className="asst-followup"
              aria-label="查看数据图表"
            >
              <BarChart3 size={13} /> 查看图表
            </button>
          )}
        </div>

        {/* Non-chart Actions (navigate links etc.) */}
        {otherActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {otherActions.map((action, i) => (
              <ActionChip key={i} action={action} />
            ))}
          </div>
        )}

        {/* Follow-up suggestions */}
        {!isUser && followUps && onSendFollowUp && (
          <FollowUpButtons items={followUps} onSend={onSendFollowUp} />
        )}

        {/* 图表弹窗 — 点击「查看图表」按钮后展开 */}
        {chartModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-[var(--background)]/70 backdrop-blur-sm" onClick={() => setChartModalOpen(false)} />
            <div className="relative w-full max-w-[min(720px,92vw)] max-h-[85vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--foreground)]">数据图表</span>
                <button onClick={() => setChartModalOpen(false)} className="neu-btn-xs"><X size={14} /></button>
              </div>
              {chartActions.map((a, i) => (
                <div key={`cht-${i}`} className="mb-4">
                  <InlineChart action={a as ChartAction} />
                </div>
              ))}
              {richCards.length > 0 && <DataCards cards={richCards} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Data Cards (ECharts + Tables from backend) ----

function DataCards({ cards }: { cards: AssistantCard[] }) {
  return (
    <div className="asst-card-stack">
      {cards.map((card, i) => {
        if (card.type === 'table') return <CardTable key={`tbl-${i}`} card={card} />;
        if (card.type === 'chart') return <CardChart key={`cht-${i}`} card={card} />;
        if (card.type === 'metric') return (
          <div key={`met-${i}`} className="asst-metric-card" style={{ '--card-accent': '#2563EB', '--card-accent-soft': 'rgba(37,99,235,0.1)' } as React.CSSProperties}>
            <div className="asst-metric-card-glow" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(37,99,235,0.1), transparent 70%)' }} />
            <div className="asst-metric-card-label">{card.title}</div>
            <div className="asst-metric-card-value-row">
              <span className="asst-metric-card-value">{card.value}</span>
            </div>
          </div>
        );
        return null;
      })}
    </div>
  );
}

function CardTable({ card }: { card: AssistantCard & { type: 'table' } }) {
  const numericKeys = new Set(
    card.columns.filter((c) => /count|value|budget|num|数量|数值|人数|预算|占比|pct/i.test(c.key)).map((c) => c.key),
  );
  return (
    <div className="asst-card-table">
      <div className="asst-card-table-header">{card.title}</div>
      <div className="asst-card-table-body">
        <table>
          <thead>
            <tr>
              {card.columns.map((c) => (
                <th key={c.key} className={numericKeys.has(c.key) ? 'asst-td-num' : ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(card.rows as Array<Record<string, unknown>>).map((row, j) => {
              const isTotal = row._total === true;
              return (
                <tr key={j} className={isTotal ? 'asst-row-total' : ''}>
                  {card.columns.map((c) => (
                    <td key={c.key} className={numericKeys.has(c.key) ? 'asst-td-num' : ''}>
                      {String(row[c.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CardChart({ card }: { card: AssistantCard & { type: 'chart' } }) {
  return (
    <div className="asst-card-chart">
      {card.title && <div className="asst-card-chart-title">{card.title}</div>}
      <div className="asst-card-chart-body">
        <ChartRenderer option={card.option} height={card.chartType === 'pie' ? 260 : 280} />
      </div>
      {card.caption && <div className="asst-card-chart-caption">{card.caption}</div>}
    </div>
  );
}

// ---- Action Chip ----

function ActionChip({ action }: { action: AssistantAction }) {
  if (action.type === "navigate") {
    return (
      <a href={action.path} className="asst-action-link">
        ↗ {action.label}
      </a>
    );
  }

  if (action.type === "chart") {
    return <InlineChart action={action as ChartAction} />;
  }

  // suggestions type is handled by FollowUpButtons, not ActionChip
  return null;
}

// ---- 内联图表组件 — 科技感设计 ----

type ChartAction = AssistantAction & {
  chartType?: string;
  title?: string;
  labels?: string[];
  values?: number[];
  subtitle?: string;
  cards?: Array<{ label: string; value: string | number; unit?: string; trend?: string }>;
};

// 科技感调色板 — 渐变色对（起止）
const PALETTE = [
  { from: "#6091f6", to: "#a0c3ff" },
  { from: "#38bdf8", to: "#7dd3fc" },
  { from: "#34d399", to: "#6ee7b7" },
  { from: "#fbbf24", to: "#fde68a" },
  { from: "#c084fc", to: "#e0b4fe" },
  { from: "#fb7185", to: "#fda4af" },
  { from: "#2dd4bf", to: "#5eead4" },
  { from: "#f472b6", to: "#f9a8d4" },
];

function InlineChart({ action }: { action: ChartAction }) {
  const chartType = action.chartType ?? "bar";
  const hasData = action.labels && action.values && action.labels.length > 0;

  return (
    <div className="asst-chart">
      {/* Chart header */}
      <div className="asst-chart-header">
        <div className="asst-chart-title-row">
          <div className="asst-chart-dot" />
          <div className="asst-chart-title">{action.title}</div>
        </div>
        {action.subtitle && (
          <div className="asst-chart-subtitle">{action.subtitle}</div>
        )}
      </div>

      {/* Chart body */}
      <div className="asst-chart-body">
        {chartType === "card_grid" && action.cards ? (
          <CardGrid cards={action.cards} />
        ) : chartType === "pie" || chartType === "doughnut" ? (
          <PieChart labels={action.labels ?? []} values={action.values ?? []} type={chartType} />
        ) : chartType === "horizontal_bar" ? (
          <HorizontalBarChart labels={action.labels ?? []} values={action.values ?? []} />
        ) : chartType === "line" && hasData ? (
          <LineChart labels={action.labels!} values={action.values!} />
        ) : hasData ? (
          <BarChart labels={action.labels!} values={action.values!} />
        ) : (
          <div className="asst-chart-empty">暂无数据</div>
        )}
      </div>
    </div>
  );
}

// ---- 柱状图 — 圆角渐变柱体 + 网格背景 ----

function BarChart({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(...values, 1);
  const barCount = labels.length;
  // 每个 bar 占 70 单位宽度（含间隔），确保文字有空间
  const viewW = Math.max(barCount * 70, 280);

  return (
    <div className="asst-chart-svg-wrap">
      <svg viewBox={`0 0 ${viewW} 76`} preserveAspectRatio="none">
        <defs>
          {PALETTE.slice(0, barCount).map((c, i) => (
            <linearGradient key={i} id={`bar${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.from} stopOpacity="0.9" />
              <stop offset="100%" stopColor={c.to} stopOpacity="0.4" />
            </linearGradient>
          ))}
          <filter id="barGlow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map((pct, i) => (
          <line
            key={i}
            x1="0" y1={60 - pct * 50}
            x2={viewW} y2={60 - pct * 50}
            stroke="rgba(120,160,240,0.08)"
            strokeWidth="0.4"
          />
        ))}
        {/* Bars */}
        {labels.map((label, i) => {
          const slotW = viewW / barCount;
          const barW = Math.min(32, slotW * 0.5);
          const x = slotW * i + (slotW - barW) / 2;
          const barH = (values[i] / max) * 50;
          const y = 60 - barH;
          return (
            <g key={i}>
              <rect x={x - 0.5} y={y - 0.5} width={barW + 1} height={barH + 1} rx="3" fill={`url(#bar${i})`} opacity="0.2" filter="url(#barGlow)" />
              <rect x={x} y={y} width={barW} height={barH} rx="2" fill={`url(#bar${i})`} />
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--foreground)">
                {formatNum(values[i])}
              </text>
              <text x={x + barW / 2} y={73} textAnchor="middle" fontSize="7" fill="var(--muted-foreground)">
                {label.length > 5 ? label.slice(0, 4) + "…" : label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- 横向柱状图 — 渐变光效 + 百分比 ----

function HorizontalBarChart({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="asst-hbar-list">
      {labels.map((label, i) => {
        const pct = (values[i] / max) * 100;
        const c = PALETTE[i % PALETTE.length];
        return (
          <div key={i} className="asst-hbar-item">
            <div className="asst-hbar-top">
              <span className="asst-hbar-label">{label}</span>
              <span className="asst-hbar-val">{formatNum(values[i])}</span>
            </div>
            <div className="asst-hbar-track">
              <div
                className="asst-hbar-fill"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${c.from}cc, ${c.to}88)`,
                  boxShadow: `0 0 6px ${c.from}33`,
                }}
              />
              <div
                className="asst-hbar-dot"
                style={{
                  left: `${pct}%`,
                  background: c.from,
                  boxShadow: `0 0 4px ${c.from}66`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- 饼图/环形图 — 渐变色块 + 中心统计 ----

function PieChart({ labels, values, type }: { labels: string[]; values: number[]; type: string }) {
  const total = values.reduce((a, b) => a + b, 0);
  const isDoughnut = type === "doughnut";
  const r = isDoughnut ? 26 : 30;
  const sw = isDoughnut ? 10 : 14;
  const circumference = 2 * Math.PI * r;
  let accumulated = 0;

  return (
    <div className="asst-pie-wrap">
      <div className="asst-pie-chart">
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <defs>
            {PALETTE.slice(0, labels.length).map((c, i) => (
              <linearGradient key={i} id={`pie${i}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={c.from} stopOpacity="0.9" />
                <stop offset="100%" stopColor={c.to} stopOpacity="0.65" />
              </linearGradient>
            ))}
            <filter id="pieGlow">
              <feGaussianBlur stdDeviation="1" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(120,160,240,0.06)" strokeWidth={sw} />
          {values.map((v, i) => {
            const segLen = total > 0 ? (v / total) * circumference : 0;
            const offset = -accumulated * circumference;
            accumulated += v / total;
            return (
              <circle
                key={i}
                cx="50" cy="50" r={r}
                fill="none"
                stroke={`url(#pie${i})`}
                strokeWidth={sw}
                strokeDasharray={`${segLen} ${circumference - segLen}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                filter="url(#pieGlow)"
              />
            );
          })}
          {isDoughnut && (
            <>
              <circle cx="50" cy="50" r={r - sw / 2 - 1} fill="rgba(255,255,255,0.9)" />
              <text x="50" y="48" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--foreground)">
                {formatNum(total)}
              </text>
              <text x="50" y="56" textAnchor="middle" fontSize="4.5" fill="var(--muted-foreground)">
                总计
              </text>
            </>
          )}
        </svg>
      </div>
      <div className="asst-pie-legend">
        {labels.map((label, i) => {
          const c = PALETTE[i % PALETTE.length];
          const pctVal = total > 0 ? ((values[i] / total) * 100).toFixed(1) : "0";
          return (
            <div key={i} className="asst-pie-legend-item">
              <span className="asst-pie-legend-dot" style={{ background: c.from, boxShadow: `0 0 3px ${c.from}55` }} />
              <span className="asst-pie-legend-label">{label}</span>
              <span className="asst-pie-legend-pct">{pctVal}%</span>
              <span className="asst-pie-legend-val">{formatNum(values[i])}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 折线图 — 渐变面积 + 光点 ----

function LineChart({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 180;
  const h = 56;
  const padX = 8;
  const padY = 6;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = values.map((v, i) => {
    const x = padX + (i / Math.max(values.length - 1, 1)) * plotW;
    const y = padY + plotH - ((v - min) / range) * plotH;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${h - padY} L${points[0].x},${h - padY} Z`;

  return (
    <div className="asst-chart-svg-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6091f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#6091f6" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6091f6" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
          <filter id="dotGlow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {[0, 0.5, 1].map((pct, i) => (
          <line key={i} x1={padX} y1={padY + (1 - pct) * plotH} x2={w - padX} y2={padY + (1 - pct) * plotH} stroke="rgba(120,160,240,0.08)" strokeWidth="0.4" />
        ))}
        <path d={areaPath} fill="url(#lineArea)" />
        <path d={linePath} fill="none" stroke="url(#lineStroke)" strokeWidth="1.2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="2.5" fill="#6091f6" opacity="0.25" filter="url(#dotGlow)" />
            <circle cx={p.x} cy={p.y} r="1.5" fill="white" stroke="#6091f6" strokeWidth="0.8" />
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={i} x={points[i].x} y={h - 0.5} textAnchor="middle" fontSize="6" fill="var(--muted-foreground)">
            {label.length > 5 ? label.slice(0, 4) + "…" : label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ---- 指标卡片 — 毛玻璃 + 发光 ----

function CardGrid({ cards }: { cards: Array<{ label: string; value: string | number; unit?: string; trend?: string }> }) {
  return (
    <div className="asst-card-grid">
      {cards.map((card, i) => {
        const c = PALETTE[i % PALETTE.length];
        return (
          <div
            key={i}
            className="asst-metric-card"
            style={{
              "--card-accent": c.from,
              "--card-accent-soft": `${c.to}33`,
            } as React.CSSProperties}
          >
            <div className="asst-metric-card-glow" style={{ background: `radial-gradient(ellipse at 30% 20%, ${c.from}15, transparent 70%)` }} />
            <div className="asst-metric-card-label">{card.label}</div>
            <div className="asst-metric-card-value-row">
              <span className="asst-metric-card-value">{card.value}</span>
              {card.unit && <span className="asst-metric-card-unit">{card.unit}</span>}
            </div>
            {card.trend && (
              <div className="asst-metric-card-trend" style={{ color: card.trend.startsWith("-") ? "rgba(220,80,80,0.85)" : "rgba(40,160,120,0.85)" }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {card.trend.startsWith("-")
                    ? <path d="M1 5.5L4 2.5L7 5.5" />
                    : <path d="M1 2.5L4 5.5L7 2.5" />}
                </svg>
                {card.trend}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- 工具 ----

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

function formatNum(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(2)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("zh-CN");
}
