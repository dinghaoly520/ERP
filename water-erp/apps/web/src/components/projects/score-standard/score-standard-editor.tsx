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
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CATEGORY_COLOR, CATEGORY_LABEL, STAGE_LABEL, isPassFailCategory } from '@water-erp/shared';
import {
  createScoreItem,
  deleteScoreItem,
  ensureBidProject,
  getBidProjectDetail,
  listScoreItems,
  publishScoreStandard,
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
    <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
      {items.length > 0 && (
        <button
          onClick={() => setShowSaveTpl(true)}
          className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
        >
          <Save size={14} strokeWidth={1.8} />
          存为模板
        </button>
      )}
      <button
        onClick={() => setShowLib(true)}
        className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
      >
        <FileSpreadsheet size={14} strokeWidth={1.8} />
        应用模板
      </button>
      {!locked && (
        <>
          <button
            onClick={handlePublish}
            className="flex items-center gap-1.5 rounded-xl bg-[#11a874] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#0e8f61]"
          >
            <Check size={14} strokeWidth={1.8} />
            发布评分标准
          </button>
          <button
            onClick={() => {
              setShowAdd(true);
              setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 });
            }}
            className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#054280]"
          >
            <Plus size={14} strokeWidth={2} />
            新增评分项
          </button>
        </>
      )}
    </div>
  );

  const tableBlock = (
    <>
      {/* ── Summary ── */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-[#f3f7fc] px-4 py-3 text-sm">
        <span className="text-[#5a6d8a]">
          评分项：<span className="font-mono font-bold text-[#18243a]">{items.length}</span> 项
        </span>
        <span className="text-[#5a6d8a]">
          打分项满分合计：<span className="font-mono font-bold text-[#064ea2]">{scoredTotal}</span> 分
        </span>
        <span className="text-[#8a96aa]">
          （含 {items.length - items.filter((i) => Number(i.maxScore) > 0).length} 项通过性审查）
        </span>
      </div>

      <div className="overflow-x-auto">
        {loading ? (
          <table className="workbench-table">
            <tbody>
              <TableSkeleton cols={5} rows={5} />
            </tbody>
          </table>
        ) : items.length === 0 && !showAdd ? (
          <div className="py-14 text-center">
            <p className="text-sm text-[#8a96aa]">该项目尚未编制评分标准。</p>
            <p className="mt-1 text-xs text-[#aab4c5]">
              评分项是评标的前置条件——无评分项则专家无法打分。请点击「应用模板」选用标准模板，或手动新增。
            </p>
          </div>
        ) : (
          <table className="workbench-table">
            <thead>
              <tr className="bg-[#f3f7fc]">
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">类别</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">评分项名称</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">满分</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[#5a6d8a]">操作</th>
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
                      className={`border-t border-[#edf2f7] ${isEdit ? '' : 'cursor-pointer hover:bg-[#f8fbff]'}`}
                      onClick={() => {
                        if (!isEdit) setExpanded((prev) => ({ ...prev, [it.id]: !prev[it.id] }));
                      }}
                    >
                      <td className="px-2 py-3 text-[#8a96aa]">
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
                          <span className="text-sm font-medium text-[#18243a]">{it.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          isPassFailCategory(editDraft.category) ? (
                            <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
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
                          <span className="font-mono text-sm font-bold text-[#064ea2]">
                            {isPassFailCategory(it.category) ? '通过性' : Number(it.maxScore) > 0 ? `${Number(it.maxScore)}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isEdit ? (
                            <>
                              <button onClick={() => handleSaveEdit(it.id)} className="rounded-lg p-1.5 text-[#11a874] hover:bg-[#ecfdf5]" title="保存">
                                <Check size={15} strokeWidth={1.8} />
                              </button>
                              <button onClick={() => setEditingId(null)} className="rounded-lg p-1.5 text-[#8a96aa] hover:bg-[#f8fafc]" title="取消">
                                <X size={15} strokeWidth={1.8} />
                              </button>
                            </>
                          ) : (
                            !locked && (
                              <>
                                <button onClick={() => startEdit(it)} className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#064ea2]" title="编辑">
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button onClick={() => setDeleteConfirm({ id: it.id, name: it.name })} className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#fef2f2] hover:text-[#e74c3c]" title="删除">
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && !isEdit && bpId && (
                      <tr className="border-t border-[#edf2f7] bg-[oklch(0.985_0.003_265)]">
                        <td colSpan={5} className="px-4 pb-4 pt-1">
                          <ScorePointsEditor projectId={bpId} item={it} points={points} onChanged={reloadItems} locked={locked} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {/* ── Add row ── */}
              {showAdd && (
                <tr className="border-t-2 border-[#064ea2] bg-[#f8fbff]">
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
                      <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
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
                      <button onClick={handleCreate} className="rounded-lg p-1.5 text-[#11a874] hover:bg-[#ecfdf5]" title="保存">
                        <Check size={15} strokeWidth={1.8} />
                      </button>
                      <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 text-[#8a96aa] hover:bg-white" title="取消">
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
        <div className="mt-4 flex items-center justify-end border-t border-[#edf2f7] pt-3 text-sm">
          <span className="text-[#5a6d8a]">满分合计</span>
          <span className="ml-2 font-mono text-lg font-black text-[#064ea2]">{totalMax}</span>
        </div>
      )}
    </>
  );

  return (
    <div className={variant === 'embedded' ? 'space-y-4' : 'space-y-6'}>
      {locked && (
        <div className="flex items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          <Lock size={14} strokeWidth={1.8} />
          <span>
            {publishedAt
              ? `评分标准已发布(${new Date(publishedAt).toLocaleString('zh-CN')}),不可修改。`
              : `项目处于「${STAGE_LABEL[stage] || stage}」阶段,评分标准已锁定,不可修改。${stage === 'EVALUATING' ? ' 专家已开始打分。' : ''}`}
          </span>
        </div>
      )}

      {variant === 'standalone' ? (
        <section className="wb-panel p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-[var(--foreground)]">评分项</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              资格审查 / 响应性为通过性审查（满分 0）；商务 / 技术 / 价格为打分项。
            </p>
          </div>
          {toolbar}
          {tableBlock}
        </section>
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
              className="rounded-xl bg-[#e74c3c] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c0392b]"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[#5a6d8a]">
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
    </div>
  );
}
