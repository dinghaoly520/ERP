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

/** 矩形块 */
export function BlockSkeleton({ w, h = 16, rounded = 'md', className = '' }: { w?: number | string; h?: number | string; rounded?: 'sm' | 'md' | 'lg' | 'full'; className?: string }) {
  const r = { sm: 'rounded', md: 'rounded-md', lg: 'rounded-lg', full: 'rounded-full' }[rounded];
  return <Shimmer className={`${r} ${className}`} style={{ width: w as React.CSSProperties['width'], height: h as React.CSSProperties['height'] }} />;
}

/** 文本行 */
export function LineSkeleton({ w = '100%', h = 12, className = '' }: { w?: number | string; h?: number | string; className?: string }) {
  return <Shimmer className={`rounded ${className}`} style={{ width: w as React.CSSProperties['width'], height: h as React.CSSProperties['height'] }} />;
}

/** 圆形（头像/badge） */
export function CircleSkeleton({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <Shimmer className={`rounded-full ${className}`} style={{ width: size, height: size }} />;
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

/** 统计卡骨架（单张） */
export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e1e9f4] bg-white p-5 shadow-[0_10px_28px_rgba(15,35,65,.05)]" role="status" aria-busy="true">
      <LineSkeleton w="40%" h={12} />
      <LineSkeleton w="60%" h={28} className="mt-3" />
      <LineSkeleton w="70%" h={10} className="mt-2" />
    </div>
  );
}

/**
 * 详情弹窗骨架 —— 匹配详情分区卡片布局
 */
export function DetailSkeleton() {
  return (
    <div className="space-y-5 px-6 py-5" role="status" aria-label="加载中" aria-busy="true">
      {/* 价格信息分区 */}
      <div className="rounded-2xl border border-[#e1e9f4] p-5">
        <LineSkeleton w="20%" h={14} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <LineSkeleton w="50%" h={10} />
              <LineSkeleton w="70%" h={14} className="mt-2" />
            </div>
          ))}
        </div>
      </div>
      {/* 趋势图分区 */}
      <div className="rounded-2xl border border-[#e1e9f4] p-5">
        <LineSkeleton w="15%" h={14} />
        <BlockSkeleton w="100%" h={170} rounded="md" className="mt-4" />
      </div>
    </div>
  );
}

/** 预算行骨架 */
export function BudgetLineSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="px-6 py-3" role="status" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-[#eef3f8] py-4">
          <div className="flex justify-between">
            <div className="min-w-0 flex-1">
              <LineSkeleton w="25%" h={10} />
              <LineSkeleton w="50%" h={14} className="mt-2" />
              <LineSkeleton w="40%" h={10} className="mt-2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
