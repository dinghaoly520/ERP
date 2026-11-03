import type { ChatCard } from "@/lib/api/assistant";

/**
 * 聊天图卡·五类手写 SVG 渲染器（2026-11-03 表下真图）——消费图卡自包含 data，
 * 与 :3005 的 ECharts option 同源派生（排序/TopN 一致），零图表库依赖。
 * 调色板与后端 chart.mapper 同源 8 色（跨门户小工具各自一份，仓库惯例）。
 * dataviz 规范：细 mark、直接标签（选择性，非逐点）、2px 表面间隙、
 * 文字用文本色（彩色 mark 承载识别）、静态本体无动画（无 reduced-motion 负担）。
 */

const P = ["#2563EB", "#0891b2", "#7dd3fc", "#0d9488", "#6366f1", "#3b82f6", "#06b6d4", "#818cf8"];
const ACCENT = P[0];

type Point = { name: string; value: number };

const fmt = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function ChartCardSvg({ card }: { card: Extract<ChatCard, { type: "chart" }> }) {
  const d = card.data;
  const title = (
    <div className="px-3 pt-2.5 text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
  );
  const caption = card.caption ? (
    <div className="px-3 pb-2.5 pt-1 text-[12px] text-[var(--muted-foreground)]">{card.caption}</div>
  ) : (
    <div className="pb-2.5" />
  );

  if (!d) {
    /* 存量历史卡（无 data）回退占位——不迁移不重算 */
    return (
      <div className="mt-1.5 overflow-hidden rounded-[12px] m-tile">
        {title}
        <div className="px-3 py-2 text-[12px] text-[var(--muted-foreground)]">
          {card.caption ?? "该图表生成于旧版本，重新提问可查看新图"}
        </div>
      </div>
    );
  }

  let body: React.ReactNode = null;
  if (card.chartType === "pie" && d.points?.length) body = <PieChart points={d.points} total={d.total} />;
  else if (card.chartType === "line" && d.points?.length) body = <LineChart labels={d.labels ?? []} points={d.points} />;
  else if (card.chartType === "grouped_bar" && d.series?.length) body = <GroupedBar labels={d.labels ?? []} series={d.series} />;
  else if (card.chartType === "hbar" && d.points?.length) body = <HBarChart points={d.points} />;
  else if (d.points?.length) body = <BarChart points={d.points} />;

  if (!body) {
    return (
      <div className="mt-1.5 overflow-hidden rounded-[12px] m-tile">
        {title}
        <div className="px-3 py-2 text-[12px] text-[var(--muted-foreground)]">数据不足，无法绘图</div>
      </div>
    );
  }
  return (
    <div className="mt-1.5 overflow-hidden rounded-[12px] m-tile">
      {title}
      {body}
      {caption}
    </div>
  );
}

/* ── 饼/环：弧段 + 中心总计 + 下方图例（文字用文本色，色点承载识别）── */
function PieChart({ points, total }: { points: Point[]; total?: number }) {
  const sum = total ?? points.reduce((s, p) => s + p.value, 0);
  const R = 52;
  const C = 70;
  const GAP = 2.5; // 段间角隙（≈2px 弧长）
  const sweepOf = (v: number) => (sum > 0 ? (v / sum) * 360 : 360 / points.length);
  const segs = points.map((p, i) => {
    const start = points.slice(0, i).reduce((s, q) => s + sweepOf(q.value), -90);
    const sweep = sweepOf(p.value);
    const a0 = start + GAP / 2;
    const a1 = start + sweep - GAP / 2;
    return { ...p, color: P[i % P.length], d: arcPath(C, C, R, a0, Math.max(a1, a0 + 0.5)) };
  });
  return (
    <div className="flex items-center gap-2 px-3 pt-1">
      <svg viewBox="0 0 140 140" className="h-[124px] w-[124px] shrink-0" role="img" aria-label="占比环形图">
        {segs.map((s) => (
          <path key={s.name + s.value} d={s.d} fill="none" stroke={s.color} strokeWidth={22} />
        ))}
        <text x={C} y={C - 3} textAnchor="middle" fontSize={17} fontWeight={800} fill="var(--foreground)">
          {fmt(sum)}
        </text>
        <text x={C} y={C + 13} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
          总计
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        {points.slice(0, 6).map((p, i) => (
          <div key={p.name + i} className="flex items-center gap-1.5 text-[12px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: P[i % P.length] }} />
            <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]">{p.name}</span>
            <span className="shrink-0 font-bold tabular-nums text-[var(--foreground)]">
              {fmt(p.value)}
              {sum > 0 ? ` · ${Math.round((p.value / sum) * 100)}%` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(a0));
  const y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/* ── 竖柱：降序、首柱强调、柱顶值标签、类目名截断 ── */
function BarChart({ points }: { points: Point[] }) {
  const W = 320;
  const H = 132;
  const padT = 20;
  const padB = 20;
  const max = Math.max(...points.map((p) => p.value), 1);
  const n = points.length;
  const colW = W / n;
  const barW = Math.min(colW * 0.52, 38);
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label="柱状图">
      {points.map((p, i) => {
        const h = Math.max(((H - padT - padB) * p.value) / max, 2);
        const x = i * colW + (colW - barW) / 2;
        const y = H - padB - h;
        return (
          <g key={p.name + i}>
            <rect x={x} y={y} width={barW} height={h} rx={4} fill={i === 0 ? ACCENT : P[i % P.length]} opacity={i === 0 ? 1 : 0.82} />
            <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={i === 0 ? 800 : 600} fill="var(--foreground)">
              {fmt(p.value)}
            </text>
            <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
              {trunc(p.name, 4)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── 横柱：降序、前三名次前缀、右端值标签 ── */
function HBarChart({ points }: { points: Point[] }) {
  const rowH = 24;
  const nameW = 96;
  const valW = 52;
  const W = 320;
  const H = points.length * rowH;
  const max = Math.max(...points.map((p) => p.value), 1);
  const barMax = W - nameW - valW - 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="排行横柱图">
      {points.map((p, i) => {
        const rank = i + 1;
        const bw = Math.max((barMax * p.value) / max, 2);
        const y = i * rowH;
        return (
          <g key={p.name + i}>
            <text x={0} y={y + 16} fontSize={11} fill="var(--muted-foreground)">
              {rank <= 3 ? `${rank}. ` : ""}
              {trunc(p.name, rank <= 3 ? 6 : 8)}
            </text>
            <rect x={nameW} y={y + 4} width={bw} height={15} rx={4} fill={P[i % P.length]} opacity={i === 0 ? 1 : 0.82} />
            <text x={nameW + bw + 5} y={y + 16} fontSize={11} fontWeight={i === 0 ? 800 : 600} fill="var(--foreground)">
              {fmt(p.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── 折线：最高点强调+标签、x 标签抽稀 ── */
function LineChart({ labels, points }: { labels: string[]; points: Point[] }) {
  const W = 320;
  const H = 120;
  const padT = 18;
  const padB = 18;
  const n = points.length;
  if (n < 2) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - 8) + 4);
  const y = (v: number) => H - padB - ((H - padT - padB) * v) / max;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const maxIdx = points.reduce((m, p, i) => (p.value > points[m].value ? i : m), 0);
  const labelStep = Math.max(1, Math.ceil(n / 5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="趋势折线图">
      <path d={path} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === maxIdx ? 4 : 2.8} fill={i === maxIdx ? ACCENT : "var(--background)"} stroke={ACCENT} strokeWidth={1.6} />
      ))}
      <text x={Math.min(Math.max(x(maxIdx), 20), W - 20)} y={Math.max(y(points[maxIdx].value) - 8, 10)} textAnchor="middle" fontSize={10} fontWeight={800} fill="var(--foreground)">
        {fmt(points[maxIdx].value)}
      </text>
      {labels.map((l, i) =>
        i % labelStep === 0 ? (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9.5} fill="var(--muted-foreground)">
            {trunc(String(l ?? ""), 5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/* ── 分组柱：组内两系、顶部 HTML 图例 ── */
function GroupedBar({ labels, series }: { labels: string[]; series: Array<{ name: string; values: number[] }> }) {
  const W = 320;
  const H = 118;
  const padT = 14;
  const padB = 18;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const n = labels.length;
  const colW = W / Math.max(n, 1);
  const barW = Math.min(colW * 0.3, 22);
  return (
    <div>
      <div className="flex justify-center gap-3 px-3 pt-1">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
            <span className="h-2 w-2 rounded-full" style={{ background: P[i % P.length] }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="分组柱状图">
        {labels.map((cat, ci) =>
          series.map((s, si) => {
            const v = s.values[ci] ?? 0;
            const h = Math.max(((H - padT - padB) * v) / max, 2);
            const gap = series.length * barW + (series.length - 1) * 2;
            const x = ci * colW + (colW - gap) / 2 + si * (barW + 2);
            const y = H - padB - h;
            return <rect key={`${cat}-${s.name}`} x={x} y={y} width={barW} height={h} rx={3} fill={P[si % P.length]} opacity={0.88} />;
          }),
        )}
        {labels.map((cat, ci) => (
          <text key={cat} x={ci * colW + colW / 2} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
            {trunc(String(cat ?? ""), 4)}
          </text>
        ))}
      </svg>
    </div>
  );
}
