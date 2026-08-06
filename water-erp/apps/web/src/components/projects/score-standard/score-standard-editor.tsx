'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CATEGORY_COLOR, CATEGORY_LABEL, STAGE_LABEL, isPassFailCategory } from '@water-erp/shared';
import {
  batchCreateScorePoints,
  createScoreItem,
  deleteScoreItem,
  ensureBidProject,
  extractAllScorePoints,
  getBidProjectDetail,
  listScoreItems,
  publishScoreStandard,
  updateBidProject,
  updateScoreItem,
  type BidProjectRef,
  type BidScoreItem,
  type ScoreCategory,
} from '@/lib/api/bid';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { Modal, TableSkeleton } from '@/components/workbench';
import { ScorePointsEditor } from './score-points-editor';
import { SaveTemplateDialog } from './save-template-dialog';
import { TemplateLibraryDialog } from './template-library-dialog';
import { BulkExtractReviewDialog, type EditableGroup } from './bulk-extract-review-dialog';

const CATEGORY_OPTIONS: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
const inputCls = 'workbench-input';

type Props = {
  project: ProjectManagementItem;
  round?: number;
  bidProject?: BidProjectRef | null;
  onChanged?: () => void;
  variant?: 'standalone' | 'embedded';
};

export function ScoreStandardEditor({ project, round, bidProject, onChanged, variant = 'standalone' }: Props) {
  const [bpId, setBpId] = useState<string | null>(bidProject?.id ?? null);
  const [stage, setStage] = useState('');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  // Phase 1：条款派生草稿开关（项目级；off=专家端不生成派生草稿，得分点映射亦隐藏）
  const [clauseDeriveEnabled, setClauseDeriveEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [items, setItems] = useState<BidScoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<{ category: ScoreCategory; name: string; maxScore: number }>({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ category: ScoreCategory; name: string; maxScore: number }>({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const [bulkGroups, setBulkGroups] = useState<EditableGroup[] | null>(null);
  const [extractingAll, setExtractingAll] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开加载 / 关闭重置，符合模态惯例 */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setShowAdd(false);
    setEditingId(null);
    (async () => {
      try {
        const bp = bidProject ?? (await ensureBidProject(project.id, round));
        const [detail, its] = await Promise.all([getBidProjectDetail(bp.id), listScoreItems(bp.id)]);
        if (cancelled) return;
        setBpId(bp.id);
        setStage(detail.stage);
        setPublishedAt(detail.scoreStandardPublishedAt ?? null);
        setClauseDeriveEnabled(!!detail.clauseDeriveEnabled);
        setItems(its);
      } catch {
        if (!cancelled) toast.error('评分标准加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按项目/轮次重载；bidProject 仅作首屏捷径
  }, [project.id, round, bidProject?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const locked = !!publishedAt || stage === 'EVALUATING' || stage === 'ARCHIVED';
  const totalMax = useMemo(() => items.reduce((s, i) => s + Number(i.maxScore), 0), [items]);
  const scoredTotal = useMemo(
    () => items.filter((i) => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0),
    [items],
  );

  // 得分点增删改后刷新 items（含 points 字段）并通知父组件
  const reloadItems = useCallback(async () => {
    if (!bpId) return;
    try {
      const refreshed = await listScoreItems(bpId);
      setItems(refreshed);
    } catch {
      /* 保留旧数据 */
    }
    onChanged?.();
  }, [bpId, onChanged]);

  // Phase 1：条款派生草稿开关切换（项目级，管理端控制；专家端据此决定是否生成派生草稿）
  const handleToggleClauseDerive = async () => {
    if (!bpId || toggling) return;
    const next = !clauseDeriveEnabled;
    setToggling(true);
    try {
      await updateBidProject(bpId, { clauseDeriveEnabled: next });
      setClauseDeriveEnabled(next);
      onChanged?.();
      toast.success(next ? '已开启「条款派生草稿」' : '已关闭「条款派生草稿」');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setToggling(false);
    }
  };

  const handlePublish = async () => {
    if (!bpId) return;
    const scoredSum = items.filter((i) => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0);
    const incomplete = items.filter((i) => Number(i.maxScore) > 0 && (!i.points || i.points.length === 0));
    if (scoredSum !== 100 || incomplete.length > 0) {
      toast.error(`发布前请确保:打分项满分合计=100(当前 ${scoredSum}),且每个打分项至少 1 个得分点`);
      return;
    }
    if (!window.confirm('发布后评分标准将锁定,不可再修改。确认发布?')) return;
    try {
      const res = await publishScoreStandard(bpId);
      setPublishedAt(res.scoreStandardPublishedAt ?? null);
      toast.success('评分标准已发布');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发布失败');
    }
  };

  const handleBulkExtract = async () => {
    if (!bpId) return;
    if (items.length === 0) {
      toast.error('请先「应用模板」或手动新增评分项');
      return;
    }
    if (items.every((i) => i.category === 'PRICE')) {
      toast.error('当前评分项均为价格项，无需 AI 提取');
      return;
    }
    setExtractingAll(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    try {
      const groups = await extractAllScorePoints(bpId, { signal: controller.signal });
      const withSelection: EditableGroup[] = groups
        .filter((g) => g.suggestions.length > 0)
        .map((g) => ({
          ...g,
          suggestions: [...g.suggestions]
            .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
            .map((s) => ({ ...s, selected: !s.duplicate })),
        }));
      if (withSelection.length === 0) {
        toast.info('AI 未提取到任何得分点建议');
      } else {
        setBulkGroups(withSelection);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.name 判 AbortError + e?.message 回退（与单项提取一致）
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.error('AI 提取超时（300s），招标文件可能较大，请稍后重试');
      } else {
        toast.error(e?.message ?? 'AI 提取暂时不可用，请稍后重试或逐项提取。');
      }
    } finally {
      clearTimeout(timer);
      setExtractingAll(false);
    }
  };

  const handleBulkImport = async (groups: EditableGroup[]) => {
    if (!bpId) return;
    const picked = groups
      .map((g) => ({ itemId: g.itemId, points: g.suggestions.filter((s) => s.selected) }))
      .filter((g) => g.points.length > 0);
    if (picked.length === 0) {
      setBulkGroups(null);
      return;
    }
    const results = await Promise.allSettled(picked.map((g) => batchCreateScorePoints(bpId, g.itemId, g.points)));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) {
      if (r.status === 'rejected') {
        toast.error(r.reason instanceof Error ? r.reason.message : '部分得分点导入失败');
      }
    }
    if (okCount > 0) {
      toast.success(`已导入得分点（${okCount}/${picked.length} 个评分项）`);
      setBulkGroups(null);
      await reloadItems();
    }
  };

  const handleCreate = async () => {
    if (!bpId) return;
    if (!draft.name.trim()) {
      toast.error('请填写评分项名称');
      return;
    }
    try {
      const created = await createScoreItem(bpId, {
        category: draft.category,
        name: draft.name.trim(),
        maxScore: isPassFailCategory(draft.category) ? 0 : Number(draft.maxScore),
      });
      setItems((prev) => [...prev, created]);
      setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 });
      setShowAdd(false);
      toast.success('评分项已新增');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '新增失败');
    }
  };

  const startEdit = (it: BidScoreItem) => {
    setEditingId(it.id);
    setEditDraft({ category: it.category, name: it.name, maxScore: Number(it.maxScore) });
  };

  const handleSaveEdit = async (id: string) => {
    if (!bpId) return;
    if (!editDraft.name.trim()) {
      toast.error('请填写评分项名称');
      return;
    }
    try {
      const updated = await updateScoreItem(bpId, id, {
        category: editDraft.category,
        name: editDraft.name.trim(),
        maxScore: isPassFailCategory(editDraft.category) ? 0 : Number(editDraft.maxScore),
      });
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setEditingId(null);
      toast.success('已保存');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const confirmDelete = async () => {
    if (!bpId || !deleteConfirm) return;
    const { id } = deleteConfirm;
    try {
      await deleteScoreItem(bpId, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success('已删除');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
    setDeleteConfirm(null);
  };

  const CategoryBadge = ({ category }: { category: string }) => {
    const color = CATEGORY_COLOR[category] || '#94a3b8';
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
        style={{ color, backgroundColor: `${color}18` }}
      >
        {CATEGORY_LABEL[category] || category}
      </span>
    );
  };

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      {/* 左侧：模板与提取 */}
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 && (
          <button onClick={() => setShowSaveTpl(true)} className="neu-btn-xs gap-1.5">
            <Save size={13} />存为模板
          </button>
        )}
        <button onClick={() => setShowLib(true)} className="neu-btn-xs gap-1.5">
          <FileSpreadsheet size={13} />应用模板
        </button>
        {!locked && (
          <button onClick={handleBulkExtract} disabled={extractingAll} className="neu-btn-xs gap-1.5 is-info">
            <Sparkles size={13} />
            {extractingAll ? '提取中…' : 'AI 提取'}
          </button>
        )}
      </div>
      {/* 右侧：发布与新增 */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setShowAdd(true); setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 }); }} className="neu-btn-soft gap-1.5">
            <Plus size={14} />新增评分项
          </button>
          <button onClick={handlePublish} className="neu-btn-primary !h-[38px] !text-xs gap-1.5">
            <Check size={14} />发布评分标准
          </button>
        </div>
      )}
    </div>
  );

  const tableBlock = (
    <>
      {/* ── Summary ── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl neu-table-card-header px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[var(--muted-foreground)]">
            评分项：<span className="font-mono font-bold text-[var(--foreground)]">{items.length}</span> 项
          </span>
          <span className="text-[var(--muted-foreground)]">
            打分项满分合计：<span className="font-mono font-bold text-[var(--accent-strong)]">{scoredTotal}</span> 分
          </span>
          <span className="text-[var(--muted-foreground)]/70">
            （含 {items.length - items.filter((i) => Number(i.maxScore) > 0).length} 项通过性审查）
          </span>
        </div>
        {/* Phase 1：条款派生草稿开关（项目级；管理端控制） */}
        <button
          type="button"
          onClick={handleToggleClauseDerive}
          disabled={!bpId || toggling}
          title="开启后，专家在「条款响应核对」提出异议/存疑时，系统按本项目「得分点↔条款」映射在打分草稿预填（异议→扣分草案、存疑→仅备注），专家可修改后提交，不会跳过提交。映射在下方得分点行维护。"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
            clauseDeriveEnabled
              ? 'border-[oklch(0.5_0.16_258_/_0.25)] text-[var(--accent-strong)]'
              : 'border-[oklch(0.6_0.04_258_/_0.18)] text-[var(--muted-foreground)]'
          }`}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${clauseDeriveEnabled ? 'bg-[var(--accent-strong)]' : 'bg-[oklch(0.7_0.01_264)]'}`} />
          条款派生草稿
          <span className="font-mono">{clauseDeriveEnabled ? '已开启' : '未开启'}</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        {loading ? (
          <table className="neu-table w-full min-w-[640px]">
            <tbody>
              <TableSkeleton cols={5} rows={5} />
            </tbody>
          </table>
        ) : items.length === 0 && !showAdd ? (
          <div className="py-14 text-center">
            <p className="text-sm text-[var(--muted-foreground)]/70">该项目尚未编制评分标准。</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]/50">
              评分项是评标的前置条件——无评分项则专家无法打分。请点击「应用模板」选用标准模板，或手动新增。
            </p>
          </div>
        ) : (
          <table className="neu-table w-full min-w-[640px]">
            <thead>
              <tr style={{ background: "oklch(0.975 0.012 258 / 0.5)" }}>
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)]">类别</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)]">评分项名称</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)]">满分</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--muted-foreground)]">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isEdit = editingId === it.id;
                const open = !!expanded[it.id];
                const points = it.points ?? [];
                return (
                  <Fragment key={it.id}>
                    <tr
                      className={`border-t oklch(0.6 0.04 258 / 0.08) ${isEdit ? '' : 'cursor-pointer hover:bg-[oklch(0.97_0.01_258_/_0.5)]'}`}
                      onClick={() => {
                        if (!isEdit) setExpanded((prev) => ({ ...prev, [it.id]: !prev[it.id] }));
                      }}
                    >
                      <td className="px-2 py-3 text-[var(--muted-foreground)]/70">
                        {!isEdit &&
                          (open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />)}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <select
                            value={editDraft.category}
                            onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value as ScoreCategory }))}
                            className={`${inputCls} w-[140px]`}
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_LABEL[c]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <CategoryBadge category={it.category} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            className={`${inputCls} w-full max-w-[360px]`}
                          />
                        ) : (
                          <span className="text-sm font-medium text-[var(--foreground)]">{it.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          isPassFailCategory(editDraft.category) ? (
                            <span className="text-xs font-bold text-[var(--muted-foreground)]">通过性</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              step="0.1"
                              value={editDraft.maxScore}
                              onChange={(e) => setEditDraft((d) => ({ ...d, maxScore: Number(e.target.value) }))}
                              className={`${inputCls} w-[100px] font-mono`}
                            />
                          )
                        ) : (
                          <span className="font-mono text-sm font-bold text-[var(--accent-strong)]">
                            {isPassFailCategory(it.category) ? '通过性' : Number(it.maxScore) > 0 ? `${Number(it.maxScore)}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isEdit ? (
                            <>
                              <button onClick={() => handleSaveEdit(it.id)} className="neu-btn-xs is-success" title="保存">
                                <Check size={15} strokeWidth={1.8} />
                              </button>
                              <button onClick={() => setEditingId(null)} className="neu-btn-xs" title="取消">
                                <X size={15} strokeWidth={1.8} />
                              </button>
                            </>
                          ) : (
                            !locked && (
                              <>
                                <button onClick={() => startEdit(it)} className="neu-btn-xs" title="编辑">
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button onClick={() => setDeleteConfirm({ id: it.id, name: it.name })} className="neu-btn-xs is-danger" title="删除">
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && !isEdit && bpId && (
                      <tr className="border-t oklch(0.6 0.04 258 / 0.08) bg-[oklch(0.985_0.003_265)]">
                        <td colSpan={5} className="px-4 pb-4 pt-1">
                          <ScorePointsEditor projectId={bpId} item={it} points={points} onChanged={reloadItems} locked={locked} linkingEnabled={clauseDeriveEnabled} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {/* ── Add row ── */}
              {showAdd && (
                <tr className="border-t-2 oklch(0.5 0.16 258) / 0.15">
                  <td className="px-2 py-3"></td>
                  <td className="px-4 py-3">
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as ScoreCategory }))}
                      className={`${inputCls} w-[140px]`}
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="如：技术方案完整性"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      className={`${inputCls} w-full max-w-[360px]`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {isPassFailCategory(draft.category) ? (
                      <span className="text-xs font-bold text-[var(--muted-foreground)]">通过性</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={draft.maxScore}
                        onChange={(e) => setDraft((d) => ({ ...d, maxScore: Number(e.target.value) }))}
                        className={`${inputCls} w-[100px] font-mono`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={handleCreate} className="neu-btn-xs is-success" title="保存">
                        <Check size={15} strokeWidth={1.8} />
                      </button>
                      <button onClick={() => setShowAdd(false)} className="neu-btn-xs" title="取消">
                        <X size={15} strokeWidth={1.8} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-4 flex items-center justify-end border-t oklch(0.6 0.04 258 / 0.08) pt-3 text-sm">
          <span className="text-[var(--muted-foreground)]">满分合计</span>
          <span className="ml-2 font-mono text-lg font-black text-[var(--accent-strong)]">{totalMax}</span>
        </div>
      )}
    </>
  );

  return (
    <div className={variant === 'embedded' ? 'space-y-4' : 'space-y-6'}>
      {locked && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
          style={{ background: 'color-mix(in oklch, var(--warning) 8%, transparent)', color: 'oklch(0.55 0.08 75)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
          <Lock size={14} />
          <span>
            {publishedAt
              ? `评分标准已发布(${new Date(publishedAt).toLocaleString('zh-CN')}),不可修改。`
              : `项目处于「${STAGE_LABEL[stage] || stage}」阶段,评分标准已锁定,不可修改。${stage === 'EVALUATING' ? ' 专家已开始打分。' : ''}`}
          </span>
        </div>
      )}

      {variant === 'standalone' ? (
        <div className="neu-table-card p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-[var(--foreground)]">评分项</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              资格审查 / 响应性为通过性审查（满分 0）；商务 / 技术 / 价格为打分项。
            </p>
          </div>
          {toolbar}
          {tableBlock}
        </div>
      ) : (
        <>
          {toolbar}
          {tableBlock}
        </>
      )}

      {/* 删除确认弹窗 */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteConfirm(null)} className="neu-btn-soft">
              取消
            </button>
            <button
              onClick={confirmDelete}
              className="neu-btn-primary is-danger !h-[38px] !text-xs"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--muted-foreground)]">
          确定要删除评分项「{deleteConfirm?.name}」吗？此操作不可撤销。
        </p>
      </Modal>

      {bpId && <SaveTemplateDialog open={showSaveTpl} onClose={() => setShowSaveTpl(false)} projectId={bpId} />}
      {bpId && (
        <TemplateLibraryDialog
          open={showLib}
          onClose={() => setShowLib(false)}
          projectId={bpId}
          locked={locked}
          onChanged={(updated) => {
            setItems(updated);
            onChanged?.();
          }}
        />
      )}
      {bulkGroups && bpId && (
        <BulkExtractReviewDialog
          open
          groups={bulkGroups}
          locked={locked}
          onClose={() => setBulkGroups(null)}
          onImport={handleBulkImport}
        />
      )}
    </div>
  );
}
