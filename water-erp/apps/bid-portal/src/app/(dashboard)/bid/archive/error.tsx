'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';

export default function ArchiveError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fef2f2] mb-4">
        <AlertTriangle size={20} strokeWidth={1.5} className="text-[#e74c3c]" />
      </div>
      <h2 className="text-sm font-bold text-[#18243a] mb-2">页面加载失败</h2>
      <p className="text-xs text-[#8a96aa] mb-6 max-w-md">
        {error.message || '发生未知错误，请重试'}
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#054280] transition"
      >
        <RotateCw size={12} strokeWidth={2} />
        重试
      </button>
    </div>
  );
}
