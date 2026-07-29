'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';

export default function BidError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[oklch(0.66_0.175_27_/_0.12)]">
        <AlertTriangle size={20} strokeWidth={1.5} className="text-[var(--danger)]" />
      </div>
      <h2 className="mb-2 text-sm font-bold text-[color:var(--foreground)]">页面加载失败</h2>
      <p className="mb-6 max-w-md text-xs text-[color:var(--muted-foreground)]">
        {error.message || '发生未知错误，请重试'}
      </p>
      <button onClick={reset} className="neu-btn-primary">
        <RotateCw size={12} strokeWidth={2} />
        重试
      </button>
    </div>
  );
}
