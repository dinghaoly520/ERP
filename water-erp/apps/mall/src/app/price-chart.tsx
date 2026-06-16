'use client';

import { useMotionValue, useSpring, motion } from 'framer-motion';
import { useState, useCallback, useMemo } from 'react';

interface PricePoint {
  recordedAt: string;
  price: number;
}

export default function PriceChart({ points, referencePrice }: { points: PricePoint[]; referencePrice?: number }) {
  if (!points || points.length < 2) {
    return <div className="py-6 text-center text-xs text-[#8a96aa]">暂无足够的价格历史数据</div>;
  }

  const W = 520;
  const H = 200; // slightly taller for benchmark line
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 32;

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

  // Interactive state
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const mx = useMotionValue(0);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const clientX = (e.clientX - rect.left) * scaleX;
    mx.set(clientX);

    // Find nearest data point
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(x(i) - clientX);
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    setHoverIdx(nearest);
  }, [mx, points]);

  const onPointerLeave = useCallback(() => setHoverIdx(null), []);

  // Reference price Y
  const refY = referencePrice != null ? y(referencePrice) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold text-[#5a6d8a]">{points[0].recordedAt.slice(0, 10)} → {points[points.length - 1].recordedAt.slice(0, 10)}</span>
        <span className={`font-black ${up ? 'text-[#e74c3c]' : 'text-[#18a56c]'}`}>{up ? '▲' : '▼'} {up ? '+' : ''}{trend.toFixed(1)}%</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="价格历史走势"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <defs>
          <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id="chartClip">
            <rect x={padL - 4} y={0} width={innerW + 8} height={H} />
          </clipPath>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + t * innerH} y2={padT + t * innerH} stroke="#eef3f8" strokeWidth="1" />
        ))}

        {/* Reference price benchmark line */}
        {refY != null && (
          <g>
            <line x1={padL} x2={W - padR} y1={refY} y2={refY} stroke={color} strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.4" />
            <text x={W - padR} y={refY - 4} fontSize="9" fill={color} textAnchor="end" opacity="0.7">参考价 {fmt(referencePrice!)}</text>
          </g>
        )}

        {/* Area fill + line with drawing animation */}
        <g clipPath="url(#chartClip)">
          {/* Area */}
          <motion.path
            d={area}
            fill="url(#priceArea)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          />
          {/* Line */}
          <motion.path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        </g>

        {/* Data points */}
        {points.map((p, i) => {
          const isExtreme = i === minIdx || i === maxIdx;
          const isHovered = hoverIdx === i;
          return (
            <motion.circle
              key={i}
              cx={x(i)}
              cy={y(p.price)}
              r={isHovered ? 5 : isExtreme ? 4 : 3}
              fill="#fff"
              stroke={color}
              strokeWidth={isHovered ? 2.5 : 2}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.3, delay: 0.5 + i * 0.02 }}
              style={{ cursor: 'pointer' }}
            >
              <title>{`${p.recordedAt.slice(0, 10)}：${fmt(p.price)}`}</title>
            </motion.circle>
          );
        })}

        {/* Hover crosshair */}
        {hoverIdx != null && (
          <g>
            <line
              x1={x(hoverIdx)} x2={x(hoverIdx)}
              y1={padT} y2={padT + innerH}
              stroke="#5a6d8a" strokeWidth="1" strokeDasharray="3 2" opacity="0.4"
            />
            <circle cx={x(hoverIdx)} cy={y(points[hoverIdx].price)} r="5" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="2" />
            {/* Tooltip */}
            <rect
              x={(x(hoverIdx) > W / 2 ? x(hoverIdx) - 82 : x(hoverIdx) + 8) as number}
              y={Math.max(4, y(points[hoverIdx].price) - 22)}
              width="72" height="36" rx="6"
              fill="#18243a" fillOpacity="0.9"
            />
            <text
              x={(x(hoverIdx) > W / 2 ? x(hoverIdx) - 78 : x(hoverIdx) + 12) as number}
              y={Math.max(14, y(points[hoverIdx].price) - 10)}
              fontSize="10" fill="#fff" fontWeight="bold"
            >
              {fmt(points[hoverIdx].price)}
            </text>
            <text
              x={(x(hoverIdx) > W / 2 ? x(hoverIdx) - 78 : x(hoverIdx) + 12) as number}
              y={Math.max(28, y(points[hoverIdx].price) + 4)}
              fontSize="8" fill="#bcc6d4"
            >
              {points[hoverIdx].recordedAt.slice(0, 10)}
            </text>
          </g>
        )}

        {/* Axis labels */}
        <text x={padL - 8} y={padT + 4} fontSize="10" fill="#8a96aa" textAnchor="end">{fmt(max)}</text>
        <text x={padL - 8} y={padT + innerH} fontSize="10" fill="#8a96aa" textAnchor="end">{fmt(min)}</text>
        <text x={x(0)} y={H - 8} fontSize="10" fill="#8a96aa" textAnchor="middle">{points[0].recordedAt.slice(5, 10)}</text>
        <text x={x(points.length - 1)} y={H - 8} fontSize="10" fill="#8a96aa" textAnchor="middle">{points[points.length - 1].recordedAt.slice(5, 10)}</text>
      </svg>
    </motion.div>
  );
}
