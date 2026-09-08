'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listScoreTemplates,
  applySavedScoreTemplate,
  applyScoreTemplate,
  deleteScoreTemplate,
  type ScoreTemplateRef,
  type BidScoreItem,
} from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  locked: boolean;
  onChanged: (items: BidScoreItem[]) => void;
  /** A-147：当前项目维度（宿主传入，与保存时服务端快照同源）；缺省则不过滤（现状全量） */
  procurementMethod?: string;
  projectCategory?: string;
}

export function TemplateLibraryDialog({
  open, onClose, projectId, locked, onChanged, procurementMethod, projectCategory,
}: Props) {
  const [templates, setTemplates] = useState<ScoreTemplateRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoreTemplateRef | null>(null);
  const [applyingStandard, setApplyingStandard] = useState(false);
  // 「仅显示通用模板」= 前端本地过滤（后端已放行 通用+当前维度，开关只隐藏带维度的行）
  const [genericOnly, setGenericOnly] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await listScoreTemplates({ procurementMethod, projectCategory }));
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开加载 / 关闭重置，符合模态惯例 */
  useEffect(() => {
    if (open) reload();
  }, [open, procurementMethod, projectCategory]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleApplyStandard = async () => {
    setApplyingStandard(true);
    try {
      const updated = await applyScoreTemplate(projectId);
      onChanged(updated);
      toast.success('已应用标准评分模板');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '应用失败');
    } finally {
      setApplyingStandard(false);
    }
  };

  const handleApply = async (t: ScoreTemplateRef) => {
    setApplyingId(t.id);
    try {
      const updated = await applySavedScoreTemplate(projectId, t.id);
      onChanged(updated);
      toast.success(`已应用模板「${t.name}」`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '应用失败');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteScoreTemplate(target.id);
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      toast.success('已删除');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="评分模板库" size="lg">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-[#f3f7fc] px-3 py-2">
          <p className="text-xs text-[#5a6d8a]">
            应用按名称合并到当前项目（已存在的项不重复添加），不会覆盖或删除已有项。
            {procurementMethod || projectCategory ? '列表已按当前项目维度筛选（通用模板始终显示）。' : ''}
          </p>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-[#5a6d8a]">
            <input
              type="checkbox"
              checked={genericOnly}
              onChange={(e) => setGenericOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#064ea2]"
            />
            仅显示通用模板
          </label>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">加载中…</div>
        ) : (
          <div className="space-y-1.5">
            {/* 系统内置标准模板（置顶） */}
            <div className="flex items-center gap-3 rounded-lg border border-[#dce6f3] bg-[#f8fbff] px-3 py-2.5">
              <FileSpreadsheet size={16} strokeWidth={1.5} className="shrink-0 text-[#064ea2]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[#18243a]">标准评分模板</span>
                  <span className="shrink-0 rounded-full bg-[#f3f7fc] px-2 py-0.5 text-xs font-bold text-[#5a6d8a]">
                    系统内置
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-[#8a96aa]">
                  系统默认 · 资格审查 / 响应性 / 商务 / 技术 / 价格五类标准项
                </div>
              </div>
              <button
                onClick={handleApplyStandard}
                disabled={locked || applyingStandard}
                title={locked ? '评分标准已锁定，无法应用' : '应用到此项目'}
                className="rounded-lg bg-[#064ea2] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {applyingStandard ? '应用中…' : '应用'}
              </button>
            </div>

            {/* 已保存模板（「仅显示通用」= 本地隐藏带维度行；跨方式复用合法，维度仅提示不硬拦） */}
            {(() => {
              const visible = genericOnly
                ? templates.filter((t) => !t.procurementMethod && !t.projectCategory)
                : templates;
              if (visible.length === 0) {
                return (
                  <div className="py-6 text-center text-sm text-[#8a96aa]">
                    {templates.length === 0
                      ? '尚无保存的模板。可在评分项页用「存为模板」创建。'
                      : '当前筛选下无模板。'}
                  </div>
                );
              }
              return visible.map((t) => {
                const mine = !!t.createdById;
                const generic = !t.procurementMethod && !t.projectCategory;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg border border-[#edf2f7] bg-white px-3 py-2.5"
                  >
                    <FileSpreadsheet size={16} strokeWidth={1.5} className="shrink-0 text-[#064ea2]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[#18243a]">{t.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                            mine ? 'bg-[#e6f0fb] text-[#064ea2]' : 'bg-[#f3f7fc] text-[#5a6d8a]'
                          }`}
                        >
                          {mine ? '我的' : '公共'}
                        </span>
                        {generic ? (
                          <span
                            className="shrink-0 rounded-full bg-[#e8f4ee] px-2 py-0.5 text-xs font-bold text-[#2f7a5e]"
                            title="通用模板：不限采购方式/项目类型，任何项目可用"
                          >
                            通用
                          </span>
                        ) : (
                          <>
                            {t.procurementMethod && (
                              <span
                                className="shrink-0 rounded-full border border-[#dce6f3] bg-[#f0f5fb] px-2 py-0.5 text-xs font-bold text-[#4a6fa5]"
                                title="保存时快照的采购方式"
                              >
                                {t.procurementMethod}
                              </span>
                            )}
                            {t.projectCategory && (
                              <span
                                className="shrink-0 rounded-full border border-[#dce6f3] bg-[#f0f5fb] px-2 py-0.5 text-xs font-bold text-[#4a6fa5]"
                                title="保存时快照的项目类型"
                              >
                                {t.projectCategory}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-[#8a96aa]">
                        {t.createdByName || '—'} · {new Date(t.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleApply(t)}
                        disabled={locked || applyingId === t.id}
                        title={locked ? '评分标准已锁定，无法应用' : '应用到此项目'}
                        className="rounded-lg bg-[#064ea2] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {applyingId === t.id ? '应用中…' : '应用'}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        title={mine ? '删除模板' : '删除公共模板（仅管理员可成功）'}
                        className="rounded-lg p-1.5 text-[#5a6d8a] transition hover:bg-[#fef2f2] hover:text-[#e74c3c]"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteTarget(null)} className="neu-btn-soft">
              取消
            </button>
            <button
              onClick={handleDelete}
              className="rounded-xl bg-[#e74c3c] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c0392b]"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[#5a6d8a]">
          确定要删除模板「{deleteTarget?.name}」吗？此操作不可撤销。
        </p>
      </Modal>
    </>
  );
}
