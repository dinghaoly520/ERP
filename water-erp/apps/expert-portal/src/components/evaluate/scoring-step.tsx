'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { BidScoreItem, BidSupplier } from '@water-erp/shared';

const CATEGORY_LABEL: Record<string, string> = {
  QUALIFICATION: '资格审查', RESPONSIVE: '响应性评审', BUSINESS: '商务评审', TECHNICAL: '技术评审', PRICE: '价格评审',
};
const CATEGORY_COLOR: Record<string, string> = {
  QUALIFICATION: '#064ea2', RESPONSIVE: '#0b63ce', BUSINESS: '#f5a623', TECHNICAL: '#11a874', PRICE: '#e74c3c',
};

interface ScoringStepProps {
  projectId: string;
  scoreItems: BidScoreItem[];
  suppliers: BidSupplier[];
  activeSupplier: string;
  expertId?: string;
  scoreLocked: boolean;
  canScoreActiveSupplier: boolean;
  initialScores?: Record<string, { score: number; reason: string }>;
  onScoresSubmitted: () => void;
}

export function ScoringStep({
  projectId,
  scoreItems,
  suppliers,
  activeSupplier,
  expertId,
  scoreLocked,
  canScoreActiveSupplier,
  initialScores,
  onScoresSubmitted,
}: ScoringStepProps) {
  const [scores, setScores] = useState<Record<string, { score: number; reason: string }>>(initialScores || {});
  const [busy, setBusy] = useState(false);
  const [missingReasons, setMissingReasons] = useState<Set<string>>(new Set());
  const [draftAvailable, setDraftAvailable] = useState<{ count: number; savedAt: number } | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scoreKey = (supplierId: string, scoreItemId: string) => `${supplierId}:${scoreItemId}`;
  const draftStorageKey = expertId ? `expert-draft:${projectId}:${expertId}` : '';

  // P2: memoize grouped score items — prevents recomputation on every keystroke
  const groupedItems = useMemo(() => {
    const grouped: Record<string, BidScoreItem[]> = {};
    for (const si of scoreItems) {
      if (!grouped[si.category]) grouped[si.category] = [];
      grouped[si.category].push(si);
    }
    return grouped;
  }, [scoreItems]);

  const scoringSupplierName = useMemo(
    () => suppliers.find(su => su.id === activeSupplier)?.supplierName || '',
    [suppliers, activeSupplier],
  );

  const totalScored = useMemo(
    () => scoreItems.reduce((s, si) => s + (scores[scoreKey(activeSupplier, si.id)]?.score ?? 0), 0),
    [scoreItems, scores, activeSupplier],
  );

  const totalMax = useMemo(
    () => scoreItems.reduce((s, si) => s + Number(si.maxScore), 0),
    [scoreItems],
  );

  // Check for unrecovered draft on mount
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string }>; savedAt: number };
      const count = Object.keys(draft.scores || {}).length;
      if (count > 0) setDraftAvailable({ count, savedAt: draft.savedAt });
    } catch { /* corrupt */ }
  }, [draftStorageKey]);

  // Debounced autosave
  useEffect(() => {
    if (!draftStorageKey) return;
    const entries = Object.keys(scores).length;
    if (entries === 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try { localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() })); }
      catch { /* quota */ }
    }, 2000);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [scores, draftStorageKey]);

  const restoreDraft = () => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { scores: Record<string, { score: number; reason: string }> };
      setScores(prev => ({ ...prev, ...draft.scores }));
      toast.success(`已恢复 ${Object.keys(draft.scores).length} 项评分草稿`);
    } catch { toast.error('草稿已损坏，无法恢复'); }
    setDraftAvailable(null);
    setDraftDismissed(true);
  };

  const discardDraft = () => {
    if (draftStorageKey) localStorage.removeItem(draftStorageKey);
    setDraftAvailable(null);
    setDraftDismissed(true);
  };

  const saveDraftNow = () => {
    if (!draftStorageKey) return;
    try { localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() })); toast.success('草稿已保存'); }
    catch { toast.error('草稿保存失败'); }
  };

  const handleSubmitScores = async () => {
    if (scoreLocked) { toast.warning('评审报告已确认，评分已锁定'); return; }
    // Validate reasons for below-max scores
    const missing: string[] = [];
    for (const si of scoreItems) {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      const score = entry?.score ?? 0;
      const reason = (entry?.reason ?? '').trim();
      if (score < Number(si.maxScore) && !reason) missing.push(si.id);
    }
    if (missing.length > 0) {
      setMissingReasons(new Set(missing));
      toast.warning(`${missing.length} 个评分项得分低于满分但未填写评分理由`);
      const firstEl = document.querySelector(`[data-score-item="${missing[0]}"]`);
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setMissingReasons(new Set());
    const scoresPayload = scoreItems.map(si => {
      const entry = scores[scoreKey(activeSupplier, si.id)];
      return { scoreItemId: si.id, supplierId: activeSupplier, score: entry?.score ?? 0, reason: entry?.reason ?? '' };
    });
    setBusy(true);
    try {
      const { api } = await import('@/lib/api');
      await api.post(`/expert/projects/${projectId}/scores`, { scores: scoresPayload, supplierName: scoringSupplierName });
      if (draftStorageKey) localStorage.removeItem(draftStorageKey);
      setDraftAvailable(null);
      onScoresSubmitted();
      toast.success(`${scoringSupplierName} 评分提交成功`);
    } catch (e: any) { toast.error(e.message || '提交失败'); }
    setBusy(false);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">专家独立打分</h2>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">请根据您的专业判断进行客观评分</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-[oklch(0.55_0.01_264)]">评分对象：</label>
          <span className="text-sm font-bold text-[#064ea2] bg-[#eff6ff] px-3 py-1.5 rounded-lg">{scoringSupplierName}</span>
        </div>
      </div>

      {/* Draft recovery banner */}
      {draftAvailable && !draftDismissed && (
        <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-center gap-3">
          <span className="text-lg">📝</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700">检测到未提交的评分草稿</p>
            <p className="text-xs text-amber-600 mt-0.5">
              {draftAvailable.count} 项评分 · 保存于 {new Date(draftAvailable.savedAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <button onClick={discardDraft} className="px-3 py-1.5 text-xs font-semibold text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition">丢弃</button>
          <button onClick={restoreDraft} className="px-4 py-1.5 text-xs font-bold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition">恢复草稿</button>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(groupedItems).map(([category, items]) => {
          const catTotal = items.reduce((s, i) => s + Number(i.maxScore), 0);
          const catScored = items.reduce((s, i) => s + (scores[scoreKey(activeSupplier, i.id)]?.score ?? 0), 0);
          return (
            <div key={category} className="bg-blue-50 rounded-xl border border-blue-100 overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-blue-100" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[category] || '#064ea2'}` }}>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ color: CATEGORY_COLOR[category] || '#064ea2', backgroundColor: (CATEGORY_COLOR[category] || '#064ea2') + '18' }}>
                    {CATEGORY_LABEL[category] || category}
                  </span>
                  <span className="text-sm text-[oklch(0.55_0.01_264)]">{items.length} 项</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[oklch(0.55_0.01_264)]">得分</span>
                  <span className="text-lg font-bold" style={{ color: CATEGORY_COLOR[category] || '#064ea2' }}>{catScored}</span>
                  <span className="text-sm text-[oklch(0.55_0.01_264)]">/ {catTotal}</span>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {items.map(item => {
                  const k = scoreKey(activeSupplier, item.id);
                  const val = scores[k];
                  const currentScore = val?.score ?? 0;
                  const max = Number(item.maxScore);
                  const pct = max > 0 ? (currentScore / max) * 100 : 0;
                  const reasonMissing = missingReasons.has(item.id);
                  return (
                    <div key={item.id} data-score-item={item.id} className={`glass-card glass-card-lighter rounded-lg p-4 ${reasonMissing ? 'border-red-300 ring-1 ring-red-200' : 'border-blue-100'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-[oklch(0.18_0.012_265)]">{item.name}</h4>
                        <span className="text-sm text-[oklch(0.55_0.01_264)]">满分 {max}</span>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <input type="range" min={0} max={max} step={0.5} value={currentScore}
                          onChange={e => setScores(prev => ({ ...prev, [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' } }))}
                          className="flex-1 h-2 bg-[oklch(0.94_0.004_264)] rounded-full appearance-none cursor-pointer accent-[#064ea2]"
                          style={{ background: `linear-gradient(to right, ${CATEGORY_COLOR[category] || '#064ea2'} ${pct}%, #f0f4f8 ${pct}%)` }}
                          aria-label={`${item.name} 评分`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={currentScore} />
                        <input type="number" min={0} max={max} step={0.5} value={currentScore}
                          onChange={e => setScores(prev => ({ ...prev, [k]: { score: Math.min(parseFloat(e.target.value) || 0, max), reason: prev[k]?.reason || '' } }))}
                          className="w-20 text-center border border-blue-100 rounded-lg px-2 py-1.5 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] outline-none"
                          aria-label={`${item.name} 数值输入`} />
                      </div>
                      <textarea placeholder="评分理由（低于满分必填）" value={val?.reason || ''}
                        onChange={e => {
                          const v = e.target.value;
                          setScores(prev => ({ ...prev, [k]: { score: prev[k]?.score ?? 0, reason: v } }));
                          if (v.trim() && missingReasons.has(item.id)) setMissingReasons(prev => { const n = new Set(prev); n.delete(item.id); return n; });
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-sm resize-none h-16 focus:outline-none focus:ring-2 ${reasonMissing ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-300' : 'border-blue-100 focus:border-[#064ea2] focus:ring-[#064ea2]'}`}
                        aria-label={`${item.name} 评分理由`} />
                      {reasonMissing && <p className="text-xs text-red-500 mt-1.5 font-semibold">⚠ 该项得分低于满分，请填写评分理由</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Summary */}
        <div className="glass-card glass-card-blue rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg text-[oklch(0.18_0.012_265)]">评分汇总 — {scoringSupplierName}</h3>
            <div className="text-right">
              <div className="text-3xl font-bold text-[#064ea2]">{totalScored}</div>
              <div className="text-sm text-[oklch(0.55_0.01_264)]">满分 {totalMax}</div>
            </div>
          </div>
          {scoreLocked && (
            <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
              评审报告已确认，评分已锁定，不可再修改。
            </div>
          )}
          {!canScoreActiveSupplier && !scoreLocked && (
            <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
              当前投标单位未解密成功或已撤回，不能提交评分。
            </div>
          )}
          <div className="flex items-center gap-3">
            {!scoreLocked && (
              <button onClick={saveDraftNow} disabled={busy}
                className="px-4 py-3 border border-[oklch(0.91_0.006_264)] text-[oklch(0.55_0.01_264)] rounded-lg font-bold text-sm hover:bg-[oklch(0.992_0.003_264)] transition disabled:opacity-50">
                保存草稿
              </button>
            )}
            <button onClick={handleSubmitScores} disabled={busy || !canScoreActiveSupplier || scoreLocked}
              className="flex-1 py-3 bg-[#064ea2] text-white rounded-lg font-bold text-sm hover:bg-[#054280] transition disabled:opacity-50">
              {busy ? '提交中...' : scoreLocked ? '评分已锁定' : `提交 ${scoringSupplierName} 的评分`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
