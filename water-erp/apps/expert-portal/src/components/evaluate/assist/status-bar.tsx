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
    decryptStatus === 'SUCCESS' ? 'bg-[#11a874]'
    : decryptStatus === 'DANGER' ? 'bg-[#e74c3c]'
    : 'bg-[#f5a623]';
  const decryptLabel = DECRYPT_LABEL[decryptStatus] || '待解密';

  return (
    <div className="grid gap-x-10 gap-y-2 mb-3 px-6 py-4 bg-white/60 rounded-xl border border-[oklch(0.91_0.006_264)]"
      style={{ gridTemplateColumns: '1fr auto auto auto', alignItems: 'center' }}>
      {/* 供应商 + 解密 */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-sm font-bold text-[oklch(0.18_0.012_265)] truncate">{supplierName}</span>
        <span className="text-[10px] text-[oklch(0.55_0.01_264)] shrink-0">{decryptLabel}</span>
      </div>
      {/* 投标报价 */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">投标报价</span>
        <span className="text-sm font-bold tabular-nums text-[oklch(0.18_0.012_265)]">{quote ?? '—'}</span>
      </div>
      {/* AI 总分（降级，不再 44px 英雄） */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[oklch(0.50_0.010_264)] select-none">AI 总分</span>
        <span className="text-xl font-bold tabular-nums text-[var(--color-primary)]">{score}</span>
      </div>
      {/* provenance */}
      <div className="flex flex-col gap-0.5 text-right">
        <span className="text-[10px] text-[oklch(0.62_0.008_264)]">{assistData.model ?? 'AI 分析'}</span>
        {assistData.generatedAt && (
          <span className="text-[10px] text-[oklch(0.62_0.008_264)]">{new Date(assistData.generatedAt).toLocaleString('zh-CN')}</span>
        )}
      </div>
    </div>
  );
}
