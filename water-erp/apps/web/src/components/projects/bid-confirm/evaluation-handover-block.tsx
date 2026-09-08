'use client';

/**
 * 评标回流包接收区块（只读）——:3005 开评标指挥中心评标后收尾。
 * :3007 签字闭环 + 生成评标回流包后回传，本区块展示「评标资料已接收 · 下载评标回流包」横幅。
 * A4（2026-09-04）：评标结果生成后（detail.evaluationResults，getProject 已下发）即展示
 * 中标候选人与金额汇总表（与回流包 evaluationResults 同源）——服务第 54 条「3 日内公示
 * 中标候选人」的时限管理，并为定标/预成交公示提供数据参考；金额=开标唱标报价。
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

  // A4：候选人与金额表随评标结果生成即展示（评标进行中 detail.evaluationResults 为空数组，不泄露）；
  // 结果与回流包均无时不渲染（签字闸门警示由 ArchiveBlock 展示，此处不重复提示）
  const results = detail.evaluationResults ?? [];
  if (results.length === 0 && !signData?.packet?.handoverFileAssetId) return null;

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center gap-2.5 min-w-0">
        <div
          className="wb-icon-well wb-icon-well--xs"
          style={{ '--well-bg': 'color-mix(in oklch, var(--success) 12%, transparent)', '--well-fg': 'var(--success)' } as React.CSSProperties}
        >
          <PenLine size={15} />
        </div>
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">评标资料接收</h3>
      </div>

      {results.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-[11px] text-[var(--muted-foreground)]">
            中标候选人（评标结果汇总，与评标回流包同源；公示发布前请勿外传）
          </div>
          <div className="overflow-hidden rounded-[12px]">
            <table className="neu-table !text-xs [&_td]:!py-2 [&_th]:!py-2">
              <thead>
                <tr>
                  <th className="!text-left">名次</th>
                  <th className="!text-left">供应商</th>
                  <th className="!text-right">总得分</th>
                  <th className="!text-right">报价</th>
                  <th className="!text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id}>
                    <td className="!text-left font-mono font-bold tabular-nums text-[var(--foreground)]">{r.rank}</td>
                    <td className="!text-left font-medium text-[var(--foreground)]">{r.supplierName}</td>
                    <td className="!text-right font-mono tabular-nums">{Number(r.totalScore).toFixed(2)}</td>
                    <td className="!text-right font-mono tabular-nums text-[var(--foreground)]">
                      {r.bidPrice != null ? `¥${Number(r.bidPrice).toLocaleString('zh-CN')}` : '—'}
                    </td>
                    <td className="!text-left">
                      {r.disqualified ? (
                        <span className="wb-status-pill" style={{ '--tone': 'var(--danger)' } as React.CSSProperties}>废标</span>
                      ) : r.recommended ? (
                        <span className="wb-status-pill" style={{ '--tone': 'var(--success)' } as React.CSSProperties}>中标候选人</span>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {signData?.packet?.handoverFileAssetId && (
        <div className="wb-tone-banner wb-tone-banner--success flex-wrap text-xs">
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
      )}
    </section>
  );
}
