'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, Sparkles, X, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createScorePoint,
  updateScorePoint,
  deleteScorePoint,
  extractScorePoints,
  batchCreateScorePoints,
  updateLinkedRequirements,
  getTenderRequirements,
  type BidScorePoint,
  type BidScoreItem,
  type ScorePointSuggestion,
} from '@/lib/api/bid';
import { SuggestionRow } from './suggestion-row';

// Phase 1：条款类别标签（与 requirement-matcher 的 category 一致）
const REQ_CAT_LABEL: Record<string, string> = { qualification: '资格', technical: '技术', commercial: '商务' };

interface Props {
  projectId: string;
  item: BidScoreItem;
  points: BidScorePoint[];
  onChanged: () => void; // 增删改后通知父组件刷新
  locked?: boolean; // 评分标准已发布/项目已进 EVALUATING/ARCHIVED 时禁用修改
  /** Phase 1：条款派生草稿开关（项目级）——off 时隐藏「关联条款」入口（映射对本项目无意义） */
  linkingEnabled?: boolean;
}

export function ScorePointsEditor({ projectId, item, points, onChanged, locked, linkingEnabled }: Props) {
  const isPassFail = item.category === 'QUALIFICATION' || item.category === 'RESPONSIVE';
  const isPrice = item.category === 'PRICE'; // 价格分按公式计算,不提取得分点
  const [draft, setDraft] = useState({ name: '', fullScore: 0, evidenceHint: '', objective: true });
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<(ScorePointSuggestion & { selected: boolean })[] | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // ── 本地得分点状态：增删改立即更新，避免父组件 reload 导致 DOM 重建 + 滚动跳顶 ──
  const [localPoints, setLocalPoints] = useState<BidScorePoint[]>(() => points);
  const localIdsRef = useRef('');
  useEffect(() => { localIdsRef.current = localPoints.map((p) => p.id).sort().join(','); }, [localPoints]);
  useEffect(() => {
    const propIds = points.map((p) => p.id).sort().join(',');
    if (propIds !== localIdsRef.current) setLocalPoints(points);
  }, [points]);

  const total = localPoints.reduce((s, p) => s + Number(p.fullScore), 0);
  const max = Number(item.maxScore);

  async function handleExtract() {
    setExtracting(true);
    setExtractError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const list = await extractScorePoints(projectId, item.id, { signal: controller.signal });
      // E3: 按 confidence 降序,重复项默认不选
      const sorted = [...list].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      setSuggestions(sorted.map((s) => ({ ...s, selected: !s.duplicate })));
      if (list.length === 0) {
        if (item.category === 'PRICE') {
          setExtractError('价格分类别的得分点由报价公式计算,无需 AI 提取。');
        } else {
          setExtractError('AI 未从招标文件提取到得分点建议。');
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.name 判 AbortError + e?.message 回退
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setExtractError('AI 提取超时（120s），招标文件可能较大，请稍后重试');
      } else {
        setExtractError(e?.message ?? 'AI 提取暂时不可用,请稍后重试或手动添加。');
      }
    } finally {
      clearTimeout(timer);
      setExtracting(false);
    }
  }

  async function handleImportSelected() {
    const picked = (suggestions ?? []).filter((s) => s.selected);
    if (picked.length === 0) { setSuggestions(null); return; }
    try {
      await batchCreateScorePoints(projectId, item.id, picked);
      setSuggestions(null);
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.message 回退提示
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败，请重试');
    }
  }

  async function add() {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      const created = await createScorePoint(projectId, item.id, {
        name: draft.name.trim(),
        fullScore: isPassFail ? 0 : Number(draft.fullScore),
        evidenceHint: draft.evidenceHint.trim() || undefined,
        objective: draft.objective,
      });
      setLocalPoints((prev) => [...prev, created]);
      setDraft({ name: '', fullScore: 0, evidenceHint: '', objective: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleObjective(p: BidScorePoint) {
    setLocalPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, objective: !p.objective } : x)));
    await updateScorePoint(projectId, item.id, p.id, { objective: !p.objective });
    onChanged();
  }

  async function remove(p: BidScorePoint) {
    setLocalPoints((prev) => prev.filter((x) => x.id !== p.id));
    await deleteScorePoint(projectId, item.id, p.id);
    onChanged();
  }

  async function editFullScore(p: BidScorePoint, v: number) {
    setLocalPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, fullScore: String(v) } : x)));
    await updateScorePoint(projectId, item.id, p.id, { fullScore: v });
    onChanged();
  }

  // ── Phase 1：得分点↔招标条款映射（独立于发布锁；lazy-load 条款列表）──
  const [linkingPoint, setLinkingPoint] = useState<BidScorePoint | null>(null);
  const [requirements, setRequirements] = useState<Array<{ requirementId: string; category: string; tenderContent: string; isStarred: boolean }> | null>(null);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
  const [linkDraft, setLinkDraft] = useState<Record<string, boolean>>({});

  async function openLinks(p: BidScorePoint) {
    setLinkingPoint(p);
    const init: Record<string, boolean> = {};
    (p.linkedRequirementIds ?? []).forEach((id) => { init[id] = true; });
    setLinkDraft(init);
    if (requirements === null) {
      setRequirementsLoading(true);
      try {
        setRequirements(await getTenderRequirements(projectId));
      } catch {
        setRequirements([]);
        toast.error('加载招标条款失败');
      } finally {
        setRequirementsLoading(false);
      }
    }
  }

  async function saveLinks() {
    if (!linkingPoint) return;
    const ids = Object.keys(linkDraft).filter((k) => linkDraft[k]);
    const prevLinked = linkingPoint.linkedRequirementIds ?? [];
    // 乐观更新本地 + 反映 count 徽标
    setLocalPoints((prev) => prev.map((x) => (x.id === linkingPoint.id ? { ...x, linkedRequirementIds: ids } : x)));
    setLinkingPoint(null);
    if (ids.length === prevLinked.length && ids.every((id) => prevLinked.includes(id))) return; // 无变化
    try {
      await updateLinkedRequirements(projectId, item.id, linkingPoint.id, ids);
      onChanged();
      toast.success(`已关联 ${ids.length} 条招标条款`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.message 回退提示
    } catch (e: any) {
      setLocalPoints((prev) => prev.map((x) => (x.id === linkingPoint.id ? { ...x, linkedRequirementIds: prevLinked } : x)));
      toast.error(e?.message ?? '保存映射失败');
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] p-3">
      {/* 合计提示 + AI 提取按钮 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        {!isPassFail ? (
          <div className="text-xs text-[oklch(0.5_0.01_264)]">
            得分点满分合计 <span className={total > max ? 'text-red-600 font-semibold' : 'font-semibold'}>{total}</span> / 大类满分 {max}
            {total > max && <span className="ml-1 text-red-600">（已超出大类满分）</span>}
            {total < max && <span className="ml-1 text-amber-600">差额 {max - total} 未分配</span>}
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          {isPrice && <span className="text-xs text-[oklch(0.55_0.01_264)]">价格分按报价公式,无需提取得分点</span>}
          {!isPrice && !locked && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="flex items-center gap-1 rounded-lg border border-[oklch(0.85_0.02_260)] bg-white px-2.5 py-1 text-xs text-[oklch(0.35_0.03_258)] disabled:opacity-50"
            title="从招标文件自动提取得分条款建议"
          >
            <Sparkles size={13} /> {extracting ? '提取中…' : 'AI 提取建议'}
          </button>
          )}
          {extractError && <span className="text-xs text-red-600">{extractError}</span>}
        </div>
      </div>

      {/* 已有得分点列表 */}
      <div className="space-y-1">
        {localPoints.map((p, idx) => (
          <div key={p.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm">
            <GripVertical size={14} className="text-[oklch(0.7_0.005_264)]" />
            <span className="text-[oklch(0.45_0.01_265)] w-6">{idx + 1}.</span>
            <span className="flex-1 font-medium text-[oklch(0.18_0.012_265)]">{p.name}</span>
            {p.evidenceHint && <span className="text-xs text-[oklch(0.55_0.01_264)]">{p.evidenceHint}</span>}
            {/* Phase 1：关联招标条款（映射编辑不受发布锁限制；linkingEnabled=项目开关 off 时隐藏） */}
            {linkingEnabled && (
              <button
                onClick={() => openLinks(p)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[oklch(0.45_0.02_258)] hover:bg-[oklch(0.96_0.01_258)]"
                title="关联招标条款（条款核对→打分草稿派生依据；可随时修改，不受发布锁限制）"
              >
                <Link2 size={13} />
                {(p.linkedRequirementIds?.length ?? 0) > 0 ? `${p.linkedRequirementIds!.length} 条款` : '关联条款'}
              </button>
            )}
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
        {localPoints.length === 0 && (
          <div className="text-xs text-[oklch(0.6_0.01_264)] py-1">暂无得分点，在下方添加。</div>
        )}
      </div>

      {/* 新增行（发布后隐藏） */}
      {!locked && (
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
      )}

      {/* AI 提取建议审核弹窗（E3+E4 增强） */}
      {suggestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">
                AI 提取得分点建议（来自招标文件） · <span className="font-mono">{suggestions.length}</span> 项
              </h3>
              <button onClick={() => setSuggestions(null)} className="text-[oklch(0.6_0.01_264)] hover:text-red-600"><X size={16} /></button>
            </div>
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {suggestions.map((s, idx) => (
                <SuggestionRow
                  key={idx}
                  suggestion={s}
                  onToggleSelected={() =>
                    setSuggestions((prev) => prev!.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)))
                  }
                  onChange={(patch) =>
                    setSuggestions((prev) => prev!.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
                  }
                />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[oklch(0.5_0.01_264)]">
                已选 {suggestions.filter((s) => s.selected).length}/{suggestions.length} 项
                {suggestions.filter((s) => s.duplicate).length > 0 && ` · ${suggestions.filter((s) => s.duplicate).length} 项疑似重复`}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setSuggestions(null)} className="rounded-lg px-3 py-1 text-sm text-[oklch(0.5_0.01_264)]">取消</button>
                {!locked && <button onClick={handleImportSelected} className="rounded-lg bg-[oklch(0.55_0.18_258)] px-3 py-1 text-sm text-white">导入选中的 {suggestions.filter((s) => s.selected).length} 项</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase 1：关联招标条款弹窗 */}
      {linkingPoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">
                关联招标条款 · <span className="font-mono">{linkingPoint.name}</span>
              </h3>
              <button onClick={() => setLinkingPoint(null)} className="text-[oklch(0.6_0.01_264)] hover:text-red-600"><X size={16} /></button>
            </div>
            <p className="mb-2 text-xs text-[oklch(0.55_0.01_264)]">
              勾选与该得分点相关的招标条款。专家在「条款响应核对」提出异议/存疑时，系统按此映射在打分草稿预填（异议→扣分草案、存疑→仅备注），专家可修改后提交。
            </p>
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {requirementsLoading ? (
                <div className="py-10 text-center text-xs text-[oklch(0.55_0.01_264)]">加载招标条款…</div>
              ) : (requirements ?? []).length === 0 ? (
                <div className="py-10 text-center text-xs text-[oklch(0.55_0.01_264)]">未检索到招标条款（可能尚未完成 AI 招标分析，或该项目无条款数据）</div>
              ) : (
                ['qualification', 'technical', 'commercial'].map((c) => {
                  const list = (requirements ?? []).filter((r) => r.category === c);
                  if (list.length === 0) return null;
                  return (
                    <div key={c} className="mb-2">
                      <div className="sticky top-0 bg-white py-1 text-xs font-bold text-[oklch(0.4_0.02_258)]">
                        {REQ_CAT_LABEL[c] ?? c}（{list.length}）
                      </div>
                      {list.map((r) => (
                        <label key={r.requirementId} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[oklch(0.98_0.003_265)]">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!!linkDraft[r.requirementId]}
                            onChange={() => setLinkDraft((prev) => ({ ...prev, [r.requirementId]: !prev[r.requirementId] }))}
                          />
                          <span className="text-[oklch(0.2_0.01_265)]">
                            {r.isStarred && <span className="mr-1 font-bold text-amber-600">★</span>}
                            {r.tenderContent || <span className="text-[oklch(0.6_0.01_264)]">（无内容）</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[oklch(0.5_0.01_264)]">已选 {Object.values(linkDraft).filter(Boolean).length} 条</span>
              <div className="flex gap-2">
                <button onClick={() => setLinkingPoint(null)} className="rounded-lg px-3 py-1 text-sm text-[oklch(0.5_0.01_264)]">取消</button>
                <button onClick={saveLinks} className="rounded-lg bg-[oklch(0.55_0.18_258)] px-3 py-1 text-sm text-white">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
