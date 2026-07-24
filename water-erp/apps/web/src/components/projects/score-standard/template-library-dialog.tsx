'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listScoreTemplates,
  applySavedScoreTemplate,
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
}

export function TemplateLibraryDialog({ open, onClose, projectId, locked, onChanged }: Props) {
  const [templates, setTemplates] = useState<ScoreTemplateRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoreTemplateRef | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await listScoreTemplates());
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        <p className="mb-3 rounded-lg bg-[#f3f7fc] px-3 py-2 text-xs text-[#5a6d8a]">
          应用按名称合并到当前项目（已存在的项不重复添加），不会覆盖或删除已有项。
        </p>

        {loading ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">加载中…</div>
        ) : templates.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">
            尚无保存的模板。可在评分项页用「存为模板」创建。
          </div>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => {
              const mine = !!t.createdById;
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
            })}
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
