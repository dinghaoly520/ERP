'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface PriceSeries { name: string; color: string; data: { date: string; price: number }[] }
interface Props { series: PriceSeries[]; title?: string; }

export function PriceTrendChart({ series, title }: Props) {
  const dateMap = new Map<string, Record<string, number>>();
  series.forEach(s => s.data.forEach(p => {
    const entry = dateMap.get(p.date) || {};
    entry[s.name] = p.price;
    dateMap.set(p.date, entry);
  }));
  const data = Array.from(dateMap.entries())
    .map(([date, prices]) => ({ date, ...prices }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="neu-card rounded-2xl p-5">
      {title && <h4 className="text-sm font-semibold text-[var(--foreground)] mb-3">{title}</h4>}
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.6 0.04 258 / 0.1)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={v => `¥${v.toLocaleString()}`} />
          <Tooltip formatter={(value: number) => [`¥${value.toLocaleString('zh-CN')}`, '']} />
          <Legend />
          {series.map(s => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
