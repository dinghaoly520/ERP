'use client';

// ─────────────────────────────────────────────
// 骨架原子层
// ─────────────────────────────────────────────

/** shimmer 基础块 */
function Shimmer({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`skeleton-shimmer rounded ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** 文本行 */
export function LineSkeleton({ w = '100%', h = 12, className = '' }: { w?: number | string; h?: number | string; className?: string }) {
  return <Shimmer className={`rounded ${className}`} style={{ width: w as React.CSSProperties['width'], height: h as React.CSSProperties['height'] }} />;
}

// ─────────────────────────────────────────────
// 骨架组合层（匹配真实布局，零 CLS）
// ─────────────────────────────────────────────

/**
 * 表格骨架 —— 匹配采购目录表格 9 列结构
 * 列宽比例匹配真实表格：编码/物资宽、规格宽、价格中、其他窄
 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  // 列宽比例（flex），匹配真实 thead 列
  const colFlexes = [2.2, 1.8, 1, 1.2, 1.4, 1.6, 1, 1, 1.4];
  return (
    <div className="w-full" role="status" aria-label="加载中" aria-busy="true">
      {/* 表头 */}
      <div className="flex gap-3 border-b border-[#eef3f8] bg-[#f7faff] px-4 py-3">
        {colFlexes.map((f, i) => (
          <Shimmer key={i} className="rounded" style={{ flex: f, height: 12 }} />
        ))}
      </div>
      {/* 行 */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 border-b border-[#eef3f8] px-4" style={{ height: 56 }}>
          {colFlexes.map((f, c) => (
            <Shimmer
              key={c}
              className="rounded"
              style={{ flex: f, height: c === 0 ? 28 : 12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 卡片网格骨架 —— 匹配统计卡 / 供应商卡 / 关注卡
 */
export function CardGridSkeleton({ count = 4, cols = 4 }: { count?: number; cols?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="status" aria-label="加载中" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[#e1e9f4] bg-white p-5 shadow-[0_10px_28px_rgba(15,35,65,.05)]">
          <LineSkeleton w="40%" h={12} />
          <LineSkeleton w="60%" h={28} className="mt-3" />
          <LineSkeleton w="70%" h={10} className="mt-2" />
        </div>
      ))}
    </div>
  );
}
