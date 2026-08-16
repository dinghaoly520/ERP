'use client';

/**
 * 评标回流包接收区块（只读）——:3005 开评标指挥中心评标后收尾。
 * :3007 签字闭环 + 生成评标回流包后回传，本区块展示「评标资料已接收 · 下载评标回流包」横幅。
 * 刷新机制：父面板（bid-confirm-panel）经 socket 事件（600ms 防抖）+ 30s 轮询持续刷新
 * detail 并换引用传入；本组件 effect 依赖 [bidProjectId, detail]，detail 每次换引用即重拉
 * getSignPacket——:3007 生成回流包后无需刷新页面，≤30s 内横幅自动出现（GET 轻量，可接受）。
 */

import { useEffect, useState } from 'react';
import { FileCheck, PenLine } from 'lucide-react';
import { getSignPacket, type BidProjectDetail, type SignPacketResponse } from '@/lib/api/bid';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
};

export function EvaluationHandoverBlock({ bidProjectId, detail }: Props) {
  const [signData, setSignData] = useState<SignPacketResponse | null>(null);

  // P1-9：依赖收敛到原始值签名——30s 轮询每轮换 detail 引用但 stage/回流产物未变时不重拉
  const refreshSignal = `${detail?.stage ?? ''}|${detail?.openingSession?.handoverAssetId ?? ''}`;
  useEffect(() => {
    let alive = true;
    getSignPacket(bidProjectId).then((r) => { if (alive) setSignData(r); }).catch(() => {});
    return () => { alive = false; };
  }, [bidProjectId, refreshSignal]);

  if (!detail) return null;
  const { stage } = detail;
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;

  // 回流包未生成时不渲染（签字闸门警示由 ArchiveBlock 展示，此处不重复提示）
  if (!signData?.packet?.handoverFileAssetId) return null;

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center gap-2.5 min-w-0">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: 'color-mix(in oklch, var(--success) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
        >
          <PenLine size={15} className="text-[var(--success)]" />
        </div>
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">评标资料接收</h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-xs" style={{ background: 'color-mix(in oklch, var(--success) 8%, transparent)' }}>
        <PenLine size={13} className="shrink-0 text-[var(--success)]" />
        <span className="font-semibold text-[var(--success)]">评标资料已接收（签字闭环 {signData.packet.closedAt ? new Date(signData.packet.closedAt).toLocaleString('zh-CN') : ''}）</span>
        <a
          href={signData.packet.handoverDownloadUrl!}
          target="_blank"
          rel="noopener"
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] hover:underline"
        >
          <FileCheck size={11} /> 下载评标回流包
        </a>
      </div>
    </section>
  );
}
