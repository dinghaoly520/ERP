import type { ChatCard } from "@/lib/api/assistant";

/** 聊天卡片——metric=指标瓷片网格 / table=迷你表 / chart=标题+说明降级（移动端不画图） */
export function ChatCardView({ card }: { card: ChatCard }) {
  if (card.type === "chart") {
    return (
      <div className="mt-1.5 rounded-[12px] m-tile px-3 py-2.5">
        <div className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
        <div className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{card.caption ?? "图表详见电脑端"}</div>
      </div>
    );
  }
  if (card.type === "metric") {
    const items = (card.metrics ?? []) as Array<{ label: string; value: string }>;
    if (items.length) {
      return (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {items.map((m, i) => (
            <div key={i} className="rounded-[12px] m-tile px-3 py-2">
              <div className="text-[12px] text-[var(--muted-foreground)]">{m.label}</div>
              <div className="mt-0.5 text-[17px] font-black leading-none tabular-nums text-[var(--foreground)]">{m.value}</div>
            </div>
          ))}
        </div>
      );
    }
    return <FallbackCard card={card} />;
  }
  const rows = (card.rows ?? []) as Array<Record<string, string>>;
  if (!rows.length) return <FallbackCard card={card} />;
  const cols = Object.keys(rows[0]).slice(0, 4);
  return (
    <div className="mt-1.5 overflow-hidden rounded-[12px] m-tile">
      <div className="px-3 pt-2.5 text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
      <div className="overflow-x-auto px-3 pb-2.5 pt-1.5">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[var(--muted-foreground)]">
              {cols.map((c) => <th key={c} className="whitespace-nowrap py-1 pr-3 font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody className="tabular-nums text-[var(--foreground)]">
            {rows.slice(0, 8).map((r, i) => (
              <tr key={i} className="border-t border-[color-mix(in_oklch,var(--border)_45%,transparent)]">
                {cols.map((c) => <td key={c} className="max-w-[10rem] truncate py-1 pr-3">{String(r[c] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FallbackCard({ card }: { card: ChatCard }) {
  const entries = Object.entries(card).filter(([k]) => k !== "type" && k !== "title").slice(0, 4);
  return (
    <div className="mt-1.5 rounded-[12px] m-tile px-3 py-2.5">
      <div className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
      {entries.map(([k, v]) => (
        <div key={k} className="mt-0.5 truncate text-[12px] text-[var(--muted-foreground)]">
          {k}: {typeof v === "string" ? v : JSON.stringify(v).slice(0, 60)}
        </div>
      ))}
    </div>
  );
}
