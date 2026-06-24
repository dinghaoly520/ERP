'use client';

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import {
  listScoreItems, createScoreItem, updateScoreItem, deleteScoreItem, applyScoreItemTemplate,
  type ScoreItem,
} from '@/lib/api/bid';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { SectionCard } from '@water-erp/ui';
import { TableSkeleton } from '@/components/skeleton';
import Dialog from '@/components/dialog';
import NoProjectGuide from '@/components/no-project-guide';
import { Plus, Pencil, Trash2, Check, X, FileSpreadsheet, Lock } from 'lucide-react';
import { CATEGORY_LABEL, CATEGORY_COLOR, STAGE_LABEL, isPassFailCategory } from '@water-erp/shared';
import { toast } from 'sonner';

const CATEGORY_OPTIONS = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
const inputCls = 'workbench-input';

export default function BidStandardPage() {
  const { projectId } = useBidProjectContext();
  const [stage, setStage] = useState('');
  const [items, setItems] = useState<ScoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      api.get<{ stage: string }>(`/bid/projects/${projectId}`).then(p => setStage(p.stage)).catch(() => {}),
      listScoreItems(projectId).then(setItems).catch(() => setItems([])),
    ]).finally(() => setLoading(false));
    setShowAdd(false);
    setEditingId(null);
  }, [projectId]);

  const locked = stage === 'EVALUATING' || stage === 'ARCHIVED';
  const totalMax = useMemo(() => items.reduce((s, i) => s + Number(i.maxScore), 0), [items]);
  const scoredTotal = useMemo(
    () => items.filter(i => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0),
    [items],
  );

  const handleApplyTemplate = async () => {
    if (!projectId) return;
    try {
      const updated = await applyScoreItemTemplate(projectId);
      setItems(updated);
      toast.success('已应用标准评分模板');
    } catch (e: any) { toast.error(e.message || '操作失败'); }
  };

  const handleCreate = async () => {
    if (!projectId) return;
    if (!draft.name.trim()) { toast.error('请填写评分项名称'); return; }
    try {
      const created = await createScoreItem(projectId, { category: draft.category, name: draft.name.trim(), maxScore: isPassFailCategory(draft.category) ? 0 : Number(draft.maxScore) });
      setItems(prev => [...prev, created]);
      setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 });
      setShowAdd(false);
      toast.success('评分项已新增');
    } catch (e: any) { toast.error(e.message || '新增失败'); }
  };

  const startEdit = (it: ScoreItem) => {
    setEditingId(it.id);
    setEditDraft({ category: it.category, name: it.name, maxScore: Number(it.maxScore) });
  };

  const handleSaveEdit = async (id: string) => {
    if (!projectId) return;
    if (!editDraft.name.trim()) { toast.error('请填写评分项名称'); return; }
    try {
      const updated = await updateScoreItem(projectId, id, {
        category: editDraft.category, name: editDraft.name.trim(), maxScore: isPassFailCategory(editDraft.category) ? 0 : Number(editDraft.maxScore),
      });
      setItems(prev => prev.map(i => (i.id === id ? updated : i)));
      setEditingId(null);
      toast.success('已保存');
    } catch (e: any) { toast.error(e.message || '保存失败'); }
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteConfirm({ id, name });
  };

  const confirmDelete = async () => {
    if (!projectId || !deleteConfirm) return;
    const { id } = deleteConfirm;
    try {
      await deleteScoreItem(projectId, id);
      setItems(prev => prev.filter(i => i.id !== id));
      toast.success('已删除');
    } catch (e: any) { toast.error(e.message || '删除失败'); }
    setDeleteConfirm(null);
  };

  const CategoryBadge = ({ category }: { category: string }) => {
    const color = CATEGORY_COLOR[category] || '#94a3b8';
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ color, backgroundColor: `${color}18` }}>
        {CATEGORY_LABEL[category] || category}
      </span>
    );
  };

  if (!projectId) return <NoProjectGuide />;
  return (
    <div className="space-y-6">
      {locked && (
        <div className="flex items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          <Lock size={14} strokeWidth={1.8} />
          <span>
            项目处于「{STAGE_LABEL[stage] || stage}」阶段，评分标准已锁定，不可修改。
            {stage === 'EVALUATING' && ' 专家已开始打分。'}
          </span>
        </div>
      )}

      <SectionCard
        title="评分项"
        description="资格审查 / 响应性为通过性审查（满分 0）；商务 / 技术 / 价格为打分项。"
        action={
          !locked && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleApplyTemplate}
                className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
              >
                <FileSpreadsheet size={14} strokeWidth={1.8} />
                应用标准模板
              </button>
              <button
                onClick={() => { setShowAdd(true); setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 }); }}
                className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#054280]"
              >
                <Plus size={14} strokeWidth={2} />
                新增评分项
              </button>
            </div>
          )
        }
      >
        {/* ── Summary ── */}
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-[#f3f7fc] px-4 py-3 text-sm">
          <span className="text-[#5a6d8a]">评分项：<span className="font-mono font-bold text-[#18243a]">{items.length}</span> 项</span>
          <span className="text-[#5a6d8a]">打分项满分合计：<span className="font-mono font-bold text-[#064ea2]">{scoredTotal}</span> 分</span>
          <span className="text-[#8a96aa]">（含 {items.length - items.filter(i => Number(i.maxScore) > 0).length} 项通过性审查）</span>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <TableSkeleton rows={5} cols={4} />
          ): items.length === 0 && !showAdd ? (
            <div className="py-14 text-center">
              <p className="text-sm text-[#8a96aa]">该项目尚未编制评分标准。</p>
              <p className="mt-1 text-xs text-[#aab4c5]">评分项是评标的前置条件——无评分项则专家无法打分。请「应用标准模板」或手动新增。</p>
            </div>
          ) : (
            <table className="workbench-table">
              <thead>
                <tr className="bg-[#f3f7fc]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">类别</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">评分项名称</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#5a6d8a]">满分</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-[#5a6d8a]">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const isEdit = editingId === it.id;
                  return (
                    <tr key={it.id} className="border-t border-[#edf2f7]">
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <select
                            value={editDraft.category}
                            onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                            className={`${inputCls} w-[140px]`}
                          >
                            {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
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
                            onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
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
                            <input type="number" min={0} step="0.1"
                              value={editDraft.maxScore}
                              onChange={e => setEditDraft(d => ({ ...d, maxScore: Number(e.target.value) }))}
                              className={`${inputCls} w-[100px] font-mono`} />
                          )
                        ) : (
                          <span className="font-mono text-sm font-bold text-[#064ea2]">
                            {isPassFailCategory(it.category) ? '通过性' : (Number(it.maxScore) > 0 ? `${Number(it.maxScore)}` : '—')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
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
                                <button onClick={() => handleDelete(it.id, it.name)} className="rounded-lg p-1.5 text-[#5a6d8a] hover:bg-[#fef2f2] hover:text-[#e74c3c]" title="删除">
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* ── Add row ── */}
                {showAdd && (
                  <tr className="border-t-2 border-[#064ea2] bg-[#f8fbff]">
                    <td className="px-4 py-3">
                      <select
                        value={draft.category}
                        onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                        className={`${inputCls} w-[140px]`}
                      >
                        {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text" placeholder="如：技术方案完整性"
                        value={draft.name}
                        onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                        className={`${inputCls} w-full max-w-[360px]`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {isPassFailCategory(draft.category) ? (
                        <span className="text-xs font-bold text-[#5a6d8a]">通过性</span>
                      ) : (
                        <input type="number" min={0} step="0.1"
                          value={draft.maxScore}
                          onChange={e => setDraft(d => ({ ...d, maxScore: Number(e.target.value) }))}
                          className={`${inputCls} w-[100px] font-mono`} />
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
      </SectionCard>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="确认删除"
        width="max-w-sm"
        footer={
          <>
            <button onClick={() => setDeleteConfirm(null)} className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">
              取消
            </button>
            <button onClick={confirmDelete} className="rounded-xl bg-[#e74c3c] px-4 py-2 text-xs font-bold text-white hover:bg-[#c0392b] transition">
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[#5a6d8a]">
          确定要删除评分项「{deleteConfirm?.name}」吗？此操作不可撤销。
        </p>
      </Dialog>
    </div>
  );
}
