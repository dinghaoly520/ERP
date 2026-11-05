"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssistantCard, Message } from "./types";
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
  followUps,
  onSendFollowUp,
}: {
  message: Message;
  followUps?: string[];
  onSendFollowUp?: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const cards = (message.cards as AssistantCard[]) ?? [];
  // 图表/表格走弹窗，指标卡保持内联（不占空间）
  const richCards = cards.filter((c) => c.type === "chart" || c.type === "table");
  const metricCards = cards.filter((c) => c.type === "metric");
  const hasRich = richCards.length > 0;

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


        {/* Follow-up suggestions */}
        {!isUser && followUps && onSendFollowUp && (
          <FollowUpButtons items={followUps} onSend={onSendFollowUp} />
        )}

        {/* 图表弹窗 — 点击「查看图表」按钮后展开。
            头部（标题+关闭）固定不随内容滚动（2026-11-03）：外壳只约束高度做 flex 列，
            滚动收敛到内容区——多张图表超出 85vh 时关闭钮不再被滚走 */}
        {chartModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-[var(--background)]/70 backdrop-blur-sm" onClick={() => setChartModalOpen(false)} />
            <div className="relative flex max-h-[85vh] w-full max-w-[min(720px,92vw)] flex-col rounded-[20px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
              <div className="flex shrink-0 items-center justify-between px-6 pb-3 pt-5">
                <span className="text-sm font-bold text-[var(--foreground)]">数据图表</span>
                <button onClick={() => setChartModalOpen(false)} className="neu-btn-xs"><X size={14} /></button>
              </div>
              <div className="overflow-y-auto px-6 pb-6">
                {richCards.length > 0 && <DataCards cards={richCards} />}
              </div>
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
        if (card.type === 'metric') {
          /* 兼容两种形状（2026-11-04 审查）：cockpit summary 卡={title,metrics:[{label,value}]}，
           * 旧单值卡={title,value}——metrics 数组缺失时回退单值，不再渲染空白卡 */
          const metrics = (card.metrics as Array<{ label: string; value: string }> | undefined) ?? [];
          return (
            <div key={`met-${i}`} className="asst-metric-card" style={{ '--card-accent': '#2563EB', '--card-accent-soft': 'rgba(37,99,235,0.1)' } as React.CSSProperties}>
              <div className="asst-metric-card-glow" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(37,99,235,0.1), transparent 70%)' }} />
              <div className="asst-metric-card-label">{card.title}</div>
              <div className="asst-metric-card-value-row">
                {metrics.length > 0
                  ? metrics.map((m, k) => (
                    <span key={k} className="asst-metric-item">
                      <span className="asst-metric-item-label">{m.label}</span>
                      <span className="asst-metric-card-value">{m.value}</span>
                    </span>
                  ))
                  : <span className="asst-metric-card-value">{card.value}</span>}
              </div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function CardTable({ card }: { card: AssistantCard & { type: 'table' } }) {
  // columns 兜底（2026-11-04 审查 P0）：cockpit stages/risk 卡曾不带 columns——裸调 .filter 即崩溃
  const cols = card.columns ?? [];
  const numericKeys = new Set(
    cols.filter((c) => /count|value|budget|num|数量|数值|人数|预算|占比|pct/i.test(c.key)).map((c) => c.key),
  );
  return (
    <div className="asst-card-table">
      <div className="asst-card-table-header">{card.title}</div>
      <div className="asst-card-table-body">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={numericKeys.has(c.key) ? 'asst-td-num' : ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(card.rows as Array<Record<string, unknown>>).map((row, j) => {
              const isTotal = row._total === true;
              return (
                <tr key={j} className={isTotal ? 'asst-row-total' : ''}>
                  {cols.map((c) => (
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
