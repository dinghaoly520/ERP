'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import {
  listScorePoints,
  createScorePoint,
  updateScorePoint,
  deleteScorePoint,
  type ScorePoint,
  type ScoreItem,
} from '@/lib/api/bid';

interface Props {
  projectId: string;
  item: ScoreItem;
  points: ScorePoint[];
  onChanged: () => void; // 增删改后通知父组件刷新
}

export function ScorePointsEditor({ projectId, item, points, onChanged }: Props) {
  const isPassFail = item.category === 'QUALIFICATION' || item.category === 'RESPONSIVE';
  const [draft, setDraft] = useState({ name: '', fullScore: 0, evidenceHint: '', objective: true });
  const [busy, setBusy] = useState(false);

  const total = points.reduce((s, p) => s + Number(p.fullScore), 0);
  const max = Number(item.maxScore);

  async function add() {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await createScorePoint(projectId, item.id, {
        name: draft.name.trim(),
        fullScore: isPassFail ? 0 : Number(draft.fullScore),
        evidenceHint: draft.evidenceHint.trim() || undefined,
        objective: draft.objective,
      });
      setDraft({ name: '', fullScore: 0, evidenceHint: '', objective: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleObjective(p: ScorePoint) {
    await updateScorePoint(projectId, item.id, p.id, { objective: !p.objective });
    onChanged();
  }

  async function remove(p: ScorePoint) {
    await deleteScorePoint(projectId, item.id, p.id);
    onChanged();
  }

  async function editFullScore(p: ScorePoint, v: number) {
    await updateScorePoint(projectId, item.id, p.id, { fullScore: v });
    onChanged();
  }

  return (
    <div className="mt-2 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] p-3">
      {/* 合计提示 */}
      {!isPassFail && (
        <div className="mb-2 text-xs text-[oklch(0.5_0.01_264)]">
          得分点满分合计 <span className={total > max ? 'text-red-600 font-semibold' : 'font-semibold'}>{total}</span> / 大类满分 {max}
          {total > max && <span className="ml-1 text-red-600">（已超出大类满分）</span>}
        </div>
      )}

      {/* 已有得分点列表 */}
      <div className="space-y-1">
        {points.map((p, idx) => (
          <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm">
            <GripVertical size={14} className="text-[oklch(0.7_0.005_264)]" />
            <span className="text-[oklch(0.45_0.01_265)] w-6">{idx + 1}.</span>
            <span className="flex-1 font-medium text-[oklch(0.18_0.012_265)]">{p.name}</span>
            {p.evidenceHint && <span className="text-xs text-[oklch(0.55_0.01_264)]">{p.evidenceHint}</span>}
            <button
              onClick={() => toggleObjective(p)}
              className={`rounded px-2 py-0.5 text-xs ${p.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
              title="客观=专家勾选制；主观=专家直接给分"
            >
              {p.objective ? '客观' : '主观'}
            </button>
            {!isPassFail && (
              <input
                type="number"
                min={0}
                step={0.5}
                defaultValue={Number(p.fullScore)}
                onBlur={(e) => editFullScore(p, Number(e.target.value))}
                className="w-16 rounded border border-[oklch(0.9_0.005_264)] px-1 py-0.5 text-right"
              />
            )}
            <button onClick={() => remove(p)} className="text-[oklch(0.6_0.01_264)] hover:text-red-600">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {points.length === 0 && (
          <div className="text-xs text-[oklch(0.6_0.01_264)] py-1">暂无得分点，在下方添加。</div>
        )}
      </div>

      {/* 新增行 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[oklch(0.92_0.004_265)] pt-2">
        <input
          type="text"
          placeholder="得分点名称（如：施工组织设计）"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="min-w-[180px] flex-1 rounded-lg border border-[oklch(0.9_0.005_264)] px-2 py-1 text-sm"
        />
        {!isPassFail && (
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="满分"
            value={draft.fullScore}
            onChange={(e) => setDraft({ ...draft, fullScore: Number(e.target.value) })}
            className="w-20 rounded-lg border border-[oklch(0.9_0.005_264)] px-2 py-1 text-sm"
          />
        )}
        <input
          type="text"
          placeholder="评审要点（可选）"
          value={draft.evidenceHint}
          onChange={(e) => setDraft({ ...draft, evidenceHint: e.target.value })}
          className="min-w-[140px] flex-1 rounded-lg border border-[oklch(0.9_0.005_264)] px-2 py-1 text-sm"
        />
        <button
          onClick={() => setDraft({ ...draft, objective: !draft.objective })}
          className={`rounded px-2 py-1 text-xs ${draft.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {draft.objective ? '客观' : '主观'}
        </button>
        <button
          onClick={add}
          disabled={busy || !draft.name.trim()}
          className="flex items-center gap-1 rounded-lg bg-[oklch(0.98_0.012_258)] px-3 py-1 text-sm text-[oklch(0.3_0.02_258)] shadow-[0_1px_0_oklch(0.9_0.004_265),0_-1px_0_oklch(1_0_0)] disabled:opacity-50"
        >
          <Plus size={14} /> 添加
        </button>
      </div>
    </div>
  );
}
