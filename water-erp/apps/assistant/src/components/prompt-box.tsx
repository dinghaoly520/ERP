'use client';

import { useState, useRef, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';

export function PromptBox({
  onSend,
  isLoading,
}: {
  onSend: (msg: string) => void;
  isLoading?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue('');
  }, [value, isLoading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="w-full max-w-[620px] relative">
      <div
        className="border rounded-2xl shadow-lg overflow-hidden"
        style={{
          borderColor: 'var(--glass-border)',
          background: 'var(--glass-bg)',
          boxShadow: 'var(--glass-shadow)',
        }}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题 / 生成分析 / 操作业务 — 例如：汇总本月招采风险并画趋势图"
          rows={2}
          className="w-full px-5 py-4 text-sm resize-none outline-none border-0 bg-transparent placeholder:text-[oklch(0.62_0.008_264)]"
        />
        <div className="flex justify-end px-4 pb-3">
          <button
            onClick={handleSend}
            disabled={!value.trim() || isLoading}
            className="p-2 rounded-xl transition cursor-pointer"
            style={{
              background: value.trim()
                ? 'oklch(0.42_0.14_260)'
                : 'oklch(0.92_0.006_264)',
              color: value.trim() ? '#fff' : 'oklch(0.62_0.008_264)',
            }}
          >
            {isLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
