'use client';
import type { AssistData } from '@water-erp/shared';
import { DECRYPT_LABEL } from '@water-erp/shared';

interface KeyInfoShape {
  quotePriceYuan?: string | number;
}

export function StatusBar({
  assistData,
  supplierName,
  decryptStatus,
}: {
  assistData: AssistData;
  supplierName: string;
  decryptStatus: string;
}) {
  const score = assistData.totalScore != null ? Number(assistData.totalScore).toFixed(1) : '—';
  const quote = (assistData.keyInfo as KeyInfoShape | undefined)?.quotePriceYuan ?? null;
  const dotColor =
    decryptStatus === 'SUCCESS' ? 'var(--success)'
    : decryptStatus === 'DANGER' ? 'var(--danger)'
    : 'var(--warning)';
  const decryptLabel = DECRYPT_LABEL[decryptStatus] || '待解密';

  return (
    <div className="neu-card-static mb-3 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-10 gap-y-2 px-6 py-4">
      {/* 供应商 + 解密 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="exp-pill-dot shrink-0" style={{ '--c': dotColor } as React.CSSProperties} />
        <span className="truncate text-sm font-bold text-[var(--foreground)]">{supplierName}</span>
        <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{decryptLabel}</span>
      </div>
      {/* 投标报价 */}
      <div className="flex flex-col gap-0.5">
        <span className="select-none text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--muted-foreground)]">投标报价</span>
        <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">{quote ?? '—'}</span>
      </div>
      {/* AI 总分（降级，不再 44px 英雄） */}
      <div className="flex flex-col gap-0.5">
        <span className="select-none text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--muted-foreground)]">AI 总分</span>
        <span className="text-xl font-bold tabular-nums text-[var(--accent-strong)]">{score}</span>
      </div>
      {/* provenance */}
      <div className="flex flex-col gap-0.5 text-right">
        <span className="text-[10px] text-[var(--muted-foreground)]">{assistData.model ?? 'AI 分析'}</span>
        {assistData.generatedAt && (
          <span className="text-[10px] text-[var(--muted-foreground)]">{new Date(assistData.generatedAt).toLocaleString('zh-CN')}</span>
        )}
      </div>
    </div>
  );
}
