'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X, Loader2 } from 'lucide-react';
import { getScoreHistory, type ScoreHistoryItem } from '@/lib/api';
import { CATEGORY_LABEL } from '@water-erp/shared';

interface Props {
  open: boolean;
  projectId: string;
  supplierId: string | null;
  suppliers: Array<{ id: string; supplierName: string }>;
  onClose: () => void;
}

export function ScoreHistoryDrawer({ open, projectId, supplierId: initialSupplierId, suppliers, onClose }: Props) {
  const [innerSupplier, setInnerSupplier] = useState('');
  const [history, setHistory] = useState<ScoreHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Computed: always resolves to a valid supplier ID, no async state gap
  const effectiveSupplier = innerSupplier || initialSupplierId || suppliers[0]?.id || '';

  useEffect(() => {
    setInnerSupplier(''); // reset inner pick on prop change
  }, [initialSupplierId]);

  useEffect(() => {
    if (!open || !effectiveSupplier) return;
    setLoading(true);
    getScoreHistory(projectId, effectiveSupplier)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [open, projectId, effectiveSupplier]);

  if (!open) return null;

  // 按 category 分组
  const grouped: Record<string, ScoreHistoryItem[]> = {};
  for (const h of history) {
    if (!grouped[h.category]) grouped[h.category] = [];
    grouped[h.category].push(h);
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="wb-panel relative z-10 flex h-full w-[440px] max-w-[90vw] flex-col !rounded-r-none">
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
            <History size={14} strokeWidth={1.7} /> 评分历史
          </h2>
          <button type="button" onClick={onClose} className="neu-btn-xs is-square" aria-label="关闭">
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
        <div className="px-4 pb-3">
          <select
            value={effectiveSupplier}
            onChange={e => setInnerSupplier(e.target.value)}
            className="neu-input !h-10 w-full text-sm"
          >
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.supplierName}</option>
            ))}
          </select>
        </div>
        <hr className="wb-section-rule shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[var(--muted-foreground)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-12 text-center text-xs text-[var(--muted-foreground)]">暂无评分项</p>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="mb-5">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                  {CATEGORY_LABEL[category] || category}
                </div>
                <div className="space-y-2">
                  {items.map(h => {
                    const hasCommitted = !!h.current.updatedAt;
                    const hasDraft = !!h.draft;
                    const hasHistory = h.history.length > 0;
                    const isUnscored = !hasCommitted && !hasDraft;
                    return (
                      <div key={h.scoreItemId} className={`rounded-[10px] border px-3 py-2 ${
                        isUnscored ? 'border-[oklch(0.6_0.04_258/0.06)] bg-transparent opacity-50'
                        : 'border-[oklch(0.6_0.04_258/0.1)] bg-[oklch(0.975_0.012_258/0.3)]'
                      }`}>
                        <div className="mb-1 text-xs font-semibold text-[var(--foreground)]">{h.scoreItemName}</div>
                        {isUnscored ? (
                          <div className="text-[10px] text-[var(--muted-foreground)]">未评分</div>
                        ) : (
                          <div className="space-y-0.5">
                            {/* 提交历史 */}
                            {hasHistory && h.history.map((snap, i) => (
                              <div key={i} className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                                <span>{snap.action === 'create' ? '✓' : '→'}</span>
                                <span className="font-medium">
                                  {snap.passed === true ? '通过' : snap.passed === false ? '不通过' : `${snap.score}分`}
                                </span>
                                <span>{snap.action === 'create' ? '创建' : '修改'}</span>
                                <span>{new Date(snap.createdAt).toLocaleString('zh-CN')}</span>
                              </div>
                            ))}
                            {/* 已提交当前值 */}
                            {hasCommitted && (
                              <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--success)]">
                                <span>✓</span>
                                <span>
                                  {h.current.passed === true ? '通过' : h.current.passed === false ? '不通过' : `${h.current.score}分`}
                                </span>
                                <span>已提交</span>
                              </div>
                            )}
                            {/* 草稿值（未提交） */}
                            {hasDraft && !hasCommitted && h.draft && (
                              <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--warning)]">
                                <span>✎</span>
                                <span>
                                  {h.draft.passed === true ? '通过' : h.draft.passed === false ? '不通过' : `${h.draft.score}分`}
                                </span>
                                <span>草稿中</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
