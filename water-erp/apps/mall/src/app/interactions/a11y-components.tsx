'use client';

// ─────────────────────────────────────────────
// <LiveRegion> — 动态变化播报给屏幕阅读器
// ─────────────────────────────────────────────

export function LiveRegion({
  children,
  politeness = 'polite',
}: {
  children: React.ReactNode;
  politeness?: 'polite' | 'assertive';
}) {
  return (
    <div aria-live={politeness} aria-atomic="true" className="sr-only">
      {children}
    </div>
  );
}
