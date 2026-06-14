'use client';

interface PricePoint {
  recordedAt: string;
  price: number;
}

/** 轻量内联 SVG 价格走势图（无第三方图表依赖）。 */
export default function PriceChart({ points }: { points: PricePoint[] }) {
  if (!points || points.length < 2) {
    return <div className="py-6 text-center text-xs text-[#8a96aa]">暂无足够的价格历史数据</div>;
  }

  const W = 520;
  const H = 170;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;

  const prices = points.map(p => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const lo = min - span * 0.12;
  const hi = max + span * 0.12;
  const range = hi - lo || 1;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i: number) => padL + (i / (points.length - 1)) * innerW;
  const y = (price: number) => padT + (1 - (price - lo) / range) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${padT + innerH} L ${x(0).toFixed(1)} ${padT + innerH} Z`;

  const first = points[0].price;
  const last = points[points.length - 1].price;
  const trend = ((last - first) / first) * 100;
  const up = trend >= 0;
  const color = up ? '#e74c3c' : '#18a56c';
  const fmt = (n: number) => `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

  const minIdx = prices.indexOf(min);
  const maxIdx = prices.indexOf(max);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold text-[#5a6d8a]">{points[0].recordedAt.slice(0, 10)} → {points[points.length - 1].recordedAt.slice(0, 10)}</span>
        <span className={`font-black ${up ? 'text-[#e74c3c]' : 'text-[#18a56c]'}`}>{up ? '▲' : '▼'} {up ? '+' : ''}{trend.toFixed(1)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="价格历史走势">
        <defs>
          <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + t * innerH} y2={padT + t * innerH} stroke="#eef3f8" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#priceArea)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.price)} r={i === minIdx || i === maxIdx ? 4 : 3} fill="#fff" stroke={color} strokeWidth="2">
            <title>{`${p.recordedAt.slice(0, 10)}：${fmt(p.price)}`}</title>
          </circle>
        ))}
        <text x={padL - 8} y={padT + 4} fontSize="10" fill="#8a96aa" textAnchor="end">{fmt(max)}</text>
        <text x={padL - 8} y={padT + innerH} fontSize="10" fill="#8a96aa" textAnchor="end">{fmt(min)}</text>
        <text x={x(0)} y={H - 8} fontSize="10" fill="#8a96aa" textAnchor="middle">{points[0].recordedAt.slice(5, 10)}</text>
        <text x={x(points.length - 1)} y={H - 8} fontSize="10" fill="#8a96aa" textAnchor="middle">{points[points.length - 1].recordedAt.slice(5, 10)}</text>
      </svg>
    </div>
  );
}
