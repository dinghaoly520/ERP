'use client';

import { useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { verifyScoreReview } from '@/lib/api';
import { toast } from 'sonner';
import {
  isPassFailCategory,
  CATEGORY_LABEL,
  CATEGORY_COLOR,
  type BidScoreItem,
} from '@water-erp/shared';

interface Props {
  projectId: string;
  supplierId: string;
  supplierName: string;
  /** project.scoreItems（含 maxScore / category） */
  scoreItems: BidScoreItem[];
  /** 该专家全部评分，键为 `${supplierId}:${scoreItemId}` */
  scores: Record<string, { score: number; reason: string; passed?: boolean }>;
  /** 该 supplier 的核对状态（来自 myExpertRecord.scoreReviews） */
  reviewStatus?: 'draft' | 'verified';
  /** 核对成功后 reload */
  onVerified: () => void;
}

const key = (sid: string, iid: string) => `${sid}:${iid}`;

export function VerifyScoreStep({
  projectId,
  supplierId,
  supplierName,
  scoreItems,
  scores,
  reviewStatus,
  onVerified,
}: Props) {
  const [busy, setBusy] = useState(false);
  const verified = reviewStatus === 'verified';

  // 按类别分组（镜像 scoring step 的分组逻辑，只读展示）
  const grouped: Record<string, BidScoreItem[]> = {};
  scoreItems.forEach((si) => {
    if (!grouped[si.category]) grouped[si.category] = [];
    grouped[si.category].push(si);
  });

  async function handleVerify() {
    setBusy(true);
    try {
      await verifyScoreReview(projectId, supplierId);
      toast.success(`${supplierName} 评分核对已确认`);
      onVerified();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '核对失败';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 标题 */}
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck size={20} strokeWidth={1.5} className="text-[#064ea2]" />
        <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">
          核对评分 — {supplierName}
        </h2>
        {verified && (
          <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
            已核对
          </span>
        )}
      </div>
      <p className="text-sm text-[oklch(0.55_0.01_264)] mb-6">
        请审阅以下评分，确认无误后点击「确认核对」。核对后评分将进入下一环节。
      </p>

      {/* 只读评分汇总（按类别） */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => {
          const catTotal = items.reduce((s, i) => s + Number(i.maxScore), 0);
          const catScored = items.reduce(
            (s, i) => s + (scores[key(supplierId, i.id)]?.score ?? 0),
            0,
          );
          const passFail = isPassFailCategory(category);
          const color = CATEGORY_COLOR[category] || '#064ea2';
          return (
            <div
              key={category}
              className="bg-blue-50 rounded-xl border border-blue-100 overflow-hidden"
            >
              {/* 类别头 */}
              <div
                className="flex items-center justify-between p-4 border-b border-blue-100"
                style={{ borderLeft: `2px solid ${color}` }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-sm font-bold px-3 py-1 rounded-lg"
                    style={{ color, backgroundColor: color + '18' }}
                  >
                    {CATEGORY_LABEL[category] || category}
                  </span>
                  <span className="text-sm text-[oklch(0.55_0.01_264)]">
                    {items.length} 项
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {passFail ? (
                    <span className="text-sm font-bold text-[oklch(0.55_0.01_264)]">
                      通过性审查
                    </span>
                  ) : (
                    <>
                      <span className="text-sm text-[oklch(0.55_0.01_264)]">得分</span>
                      <span className="text-lg font-bold" style={{ color }}>
                        {catScored}
                      </span>
                      <span className="text-sm text-[oklch(0.55_0.01_264)]">
                        / {catTotal}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {/* 条目列表（只读） */}
              <div className="p-4 space-y-3">
                {items.map((item) => {
                  const entry = scores[key(supplierId, item.id)];
                  const itemPassFail = isPassFailCategory(item.category);
                  return (
                    <div
                      key={item.id}
                      className="glass-card glass-card-lighter rounded-lg p-4 border-blue-100"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[oklch(0.18_0.012_265)]">
                            {item.name}
                          </div>
                          {item.scoringCriteria && (
                            <div className="text-xs text-[oklch(0.55_0.01_264)] mt-1 line-clamp-2">
                              {item.scoringCriteria}
                            </div>
                          )}
                          {entry?.reason && (
                            <div className="text-xs text-[oklch(0.45_0.01_264)] mt-2 bg-white/60 rounded px-2 py-1 border border-[oklch(0.91_0.006_264)]">
                              理由：{entry.reason}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {itemPassFail ? (
                            <span
                              className={`text-sm font-bold ${entry?.passed === false ? 'text-[#e74c3c]' : entry?.passed === true ? 'text-[#11a874]' : 'text-[oklch(0.55_0.01_264)]'}`}
                            >
                              {entry?.passed === false
                                ? '不通过'
                                : entry?.passed === true
                                  ? '通过'
                                  : '未评'}
                            </span>
                          ) : (
                            <span className="text-sm text-[oklch(0.55_0.01_264)]">
                              <span className="font-bold text-[oklch(0.18_0.012_265)]">
                                {entry?.score ?? 0}
                              </span>{' '}
                              / {Number(item.maxScore)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 确认核对按钮 */}
      <button
        type="button"
        onClick={handleVerify}
        disabled={busy || verified}
        className="mt-6 w-full py-3 bg-[#11a874] text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 transition hover:bg-[#0e8f62]"
      >
        <Check size={16} strokeWidth={2.5} />
        {verified ? '已核对' : busy ? '核对中…' : '确认核对'}
      </button>
    </div>
  );
}
