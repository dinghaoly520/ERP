'use client';

import { useState } from 'react';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@water-erp/shared';
import type { ScorePointSuggestion, ScorePointSuggestionGroup } from '@/lib/api/bid';
import { Modal } from '@/components/workbench';
import { SuggestionRow, type EditableSuggestion } from './suggestion-row';

export type EditableGroup = Omit<ScorePointSuggestionGroup, 'suggestions'> & {
  suggestions: EditableSuggestion[];
};

interface Props {
  open: boolean;
  groups: EditableGroup[]; // 调用方已按 confidence 降序 + duplicate 默认不选
  locked: boolean;
  onClose: () => void;
  onImport: (groups: EditableGroup[]) => Promise<void>;
}

/** 一键 AI 提取的分组审核弹窗：按评分项分组展示建议，勾选后批量导入 */
export function BulkExtractReviewDialog({ open, groups, locked, onClose, onImport }: Props) {
  const [state, setState] = useState<EditableGroup[]>(groups);
  const [importing, setImporting] = useState(false);

  const total = state.reduce((s, g) => s + g.suggestions.length, 0);
  const selectedCount = state.reduce((s, g) => s + g.suggestions.filter((x) => x.selected).length, 0);
  const duplicateCount = state.reduce((s, g) => s + g.suggestions.filter((x) => x.duplicate).length, 0);

  const patchSuggestion = (itemId: string, idx: number, patch: Partial<ScorePointSuggestion>) =>
    setState((prev) =>
      prev.map((g) =>
        g.itemId === itemId
          ? { ...g, suggestions: g.suggestions.map((p, i) => (i === idx ? { ...p, ...patch } : p)) }
          : g,
      ),
    );

  const toggleSuggestion = (itemId: string, idx: number) =>
    setState((prev) =>
      prev.map((g) =>
        g.itemId === itemId
          ? {
              ...g,
              suggestions: g.suggestions.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)),
            }
          : g,
      ),
    );

  const toggleGroupAll = (itemId: string, selected: boolean) =>
    setState((prev) =>
      prev.map((g) =>
        g.itemId === itemId ? { ...g, suggestions: g.suggestions.map((p) => ({ ...p, selected })) } : g,
      ),
    );

  const toggleAll = (selected: boolean) =>
    setState((prev) => prev.map((g) => ({ ...g, suggestions: g.suggestions.map((p) => ({ ...p, selected })) })));

  const handleImport = async () => {
    setImporting(true);
    try {
      await onImport(state);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 提取得分点建议（来自招标文件）"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">
            取消
          </button>
          {!locked && (
            <button
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
              className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {importing ? '导入中…' : `导入选中的 ${selectedCount} 项`}
            </button>
          )}
        </>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto">
        <div className="mb-3 flex items-center justify-between rounded-lg bg-[#f3f7fc] px-3 py-2 text-xs text-[#5a6d8a]">
          <span>
            共 <span className="font-mono font-bold">{total}</span> 项建议 · 已选{' '}
            <span className="font-mono font-bold">{selectedCount}</span> 项
            {duplicateCount > 0 && ` · ${duplicateCount} 项疑似重复`}
          </span>
          <button
            onClick={() => toggleAll(selectedCount < total)}
            className="font-bold text-[#064ea2] hover:underline"
          >
            {selectedCount === total ? '取消全选' : '全选'}
          </button>
        </div>

        <div className="space-y-4">
          {state.map((g) => {
            const color = CATEGORY_COLOR[g.category] || '#94a3b8';
            const groupSelected = g.suggestions.filter((s) => s.selected).length;
            return (
              <div key={g.itemId}>
                <div className="mb-1.5 flex items-center gap-2 text-sm">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
                    style={{ color, backgroundColor: `${color}18` }}
                  >
                    {CATEGORY_LABEL[g.category] || g.category}
                  </span>
                  <span className="font-medium text-[#18243a]">{g.itemName}</span>
                  <span className="font-mono text-xs text-[#8a96aa]">大类满分 {g.maxScore}</span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-[#5a6d8a]">
                    已选 {groupSelected}/{g.suggestions.length}
                    <button
                      onClick={() => toggleGroupAll(g.itemId, groupSelected < g.suggestions.length)}
                      className="ml-1 font-bold text-[#064ea2] hover:underline"
                    >
                      {groupSelected === g.suggestions.length ? '取消全选' : '全选'}
                    </button>
                  </span>
                </div>
                <div className="space-y-1.5">
                  {g.suggestions.map((s, idx) => (
                    <SuggestionRow
                      key={idx}
                      suggestion={s}
                      onToggleSelected={() => toggleSuggestion(g.itemId, idx)}
                      onChange={(patch) => patchSuggestion(g.itemId, idx, patch)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
