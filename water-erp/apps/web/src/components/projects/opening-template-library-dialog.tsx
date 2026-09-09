'use client';

/**
 * A-115：开标记录模板库（kind=opening_record）——列模板 / 应用到项目 / 设为生效 / 删除 / 行内轻编辑 / 存为模板。
 * 应用走 PUT /bid/projects/:id/opening-field-config {fromTemplateId}（与配置卡同一写径与阶段闸——OPENING 后 409）。
 * 模板库与项目阶段解耦：建 / 改 / 启停不受锁定影响，仅「应用到项目」随锁定禁用（生效模板供监管导出使用）。
 * 范式：score-standard/template-library-dialog.tsx（Modal@workbench + toast(sonner) + 行操作）。
 */
import { useEffect, useRef, useState } from 'react';
import { ListChecks, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  activateWorkTemplate,
  createWorkTemplate,
  deleteWorkTemplate,
  listWorkTemplates,
  setOpeningFieldConfig,
  updateWorkTemplate,
  type OpeningFieldDef,
  type WorkTemplateRef,
} from '@/lib/api/bid';
import { Modal } from '@/components/workbench';

type Props = {
  open: boolean;
  /** 打开意图：'save' = 从配置卡「存为模板…」进入，聚焦底部名称输入 */
  intent: 'manage' | 'save';
  onClose: () => void;
  projectId: string;
  /** 项目阶段锁定（OPENING/EVALUATING/ARCHIVED）——仅禁「应用到项目」 */
  locked: boolean;
  /** 配置卡当前字段（含未保存草稿）——「存为当前项目配置为模板」数据源 */
  currentFields: OpeningFieldDef[];
  /** 应用成功后回调（宿主 load() 回读项目配置） */
  onChanged: () => void;
};

type EditState = {
  id: string;
  nameDraft: string;
  fieldsDraft: string;
  error: string | null;
};

const OPENING_RECORD_KIND = 'opening_record';

export function OpeningTemplateLibraryDialog({
  open, intent, onClose, projectId, locked, currentFields, onChanged,
}: Props) {
  const [templates, setTemplates] = useState<WorkTemplateRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkTemplateRef | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saveName, setSaveName] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);
  const saveNameRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await listWorkTemplates(OPENING_RECORD_KIND));
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开加载 / 意图聚焦，符合模态惯例 */
  useEffect(() => {
    if (open) {
      setEditing(null);
      reload();
    }
  }, [open]);

  useEffect(() => {
    if (open && intent === 'save') saveNameRef.current?.focus();
  }, [open, intent]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleApply = async (t: WorkTemplateRef) => {
    setApplyingId(t.id);
    try {
      await setOpeningFieldConfig(projectId, { fromTemplateId: t.id });
      toast.success(`已应用模板「${t.name}」的唱标字段配置`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '应用失败');
    } finally {
      setApplyingId(null);
    }
  };

  const handleActivate = async (t: WorkTemplateRef) => {
    setActivatingId(t.id);
    try {
      await activateWorkTemplate(t.id);
      toast.success(`模板「${t.name}」已设为生效（监管导出按此模板输出）`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '设置失败');
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteWorkTemplate(target.id);
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      toast.success(`已删除模板「${target.name}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  const startEdit = (t: WorkTemplateRef) => {
    setEditing({
      id: t.id,
      nameDraft: t.name,
      fieldsDraft: JSON.stringify(t.content.fields ?? [], null, 2),
      error: null,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editing.fieldsDraft);
    } catch {
      setEditing({ ...editing, error: 'fields JSON 语法错误，请检查' });
      return;
    }
    if (!Array.isArray(parsed)) {
      setEditing({ ...editing, error: 'fields 须为字段数组（[{key,label,type,…}]）' });
      return;
    }
    const tooLong = (parsed as OpeningFieldDef[]).find(
      (f) => typeof f?.label === 'string' && f.label.length > 20,
    );
    if (tooLong) {
      setEditing({ ...editing, error: `字段「${tooLong.key}」label 超过 20 字` });
      return;
    }
    const original = templates.find((t) => t.id === editing.id);
    try {
      // content 整体替换——保留既有 columns（导出列语义）等其他键
      await updateWorkTemplate(editing.id, {
        name: editing.nameDraft.trim(),
        content: { ...(original?.content ?? {}), fields: parsed },
      });
      toast.success('模板已更新');
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleSaveAsTemplate = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSavingTpl(true);
    try {
      await createWorkTemplate({ kind: OPENING_RECORD_KIND, name, content: { fields: currentFields } });
      toast.success(`模板「${name}」已保存（${currentFields.length} 个唱标字段）`);
      setSaveName('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingTpl(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="开标记录模板库" size="lg">
        <div className="mb-3 rounded-lg bg-[var(--accent-soft)] px-3 py-2">
          <p className="text-xs text-[var(--muted-foreground)]">
            「应用」= 把模板的唱标字段写入本项目（开标开始后锁定）；「生效中」模板供监管导出使用，同类仅一个生效，生效中不可删除。
          </p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
        ) : templates.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">
            尚无开标记录模板。可在下方将当前项目唱标字段配置存为模板。
          </div>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => {
              const fieldCount = t.content.fields?.length ?? 0;
              const hasColumns = !!t.content.columns?.length;
              return (
                <div key={t.id}>
                  <div className="flex items-center gap-3 rounded-xl bg-[var(--surface)] px-3 py-2.5 shadow-[inset_0_1px_0_oklch(1_0_0_/_0.7)]">
                    <ListChecks size={16} strokeWidth={1.5} className="shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--foreground)]">{t.name}</span>
                        {t.isActive && (
                          <span className="shrink-0 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">
                            生效中
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {fieldCount} 个唱标字段
                        {hasColumns ? ' · 含导出列预设' : ''}
                        {fieldCount === 0 && <span className="text-[var(--warning)]">（未定义唱标字段，不可应用）</span>}
                        {' · '}更新于 {new Date(t.updatedAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleApply(t)}
                        disabled={locked || applyingId === t.id || fieldCount === 0}
                        title={locked ? '开标已开始，字段配置已锁定' : fieldCount === 0 ? '模板未定义唱标字段' : '应用到此项目'}
                        className="neu-btn-xs !h-[30px]"
                      >
                        {applyingId === t.id ? '应用中…' : '应用'}
                      </button>
                      <button
                        onClick={() => handleActivate(t)}
                        disabled={t.isActive || activatingId === t.id}
                        title={t.isActive ? '已是生效模板' : '设为生效（同类其余自动停用）'}
                        className="neu-btn-xs !h-[30px]"
                      >
                        {activatingId === t.id ? '设置中…' : '设为生效'}
                      </button>
                      <button
                        onClick={() => (editing?.id === t.id ? setEditing(null) : startEdit(t))}
                        title={editing?.id === t.id ? '收起编辑' : '编辑模板'}
                        className="neu-btn-xs !h-[30px] !w-[30px] !p-0 justify-center"
                      >
                        {editing?.id === t.id ? <span className="text-xs font-bold">收起</span> : <Pencil size={13} strokeWidth={1.5} />}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        disabled={t.isActive}
                        title={t.isActive ? '生效中不可删，先启用其他模板' : '删除模板'}
                        className="neu-btn-xs !h-[30px] !w-[30px] !p-0 justify-center is-danger"
                      >
                        <Trash2 size={13} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>

                  {/* 行内轻编辑：name + fields JSON 文本域（完整形状校验在后端，前端只拦 JSON 语法与 label 长度） */}
                  {editing?.id === t.id && (
                    <div className="mt-1.5 space-y-2 rounded-xl bg-[var(--accent-soft)] px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs font-semibold text-[var(--foreground)]">模板名称</label>
                        <input
                          className="workbench-input !h-8 flex-1 min-w-[160px] !px-2 !text-xs"
                          value={editing.nameDraft}
                          maxLength={50}
                          onChange={(e) => setEditing({ ...editing, nameDraft: e.target.value })}
                        />
                      </div>
                      <textarea
                        className="neu-input w-full font-mono !text-[11px] leading-relaxed"
                        rows={8}
                        value={editing.fieldsDraft}
                        spellCheck={false}
                        onChange={(e) => setEditing({ ...editing, fieldsDraft: e.target.value, error: null })}
                      />
                      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                        字段对象：{'{ key, label(≤20 字), type: text|number|select, options?(select 必带), required?, prefillFrom?(仅法定键) }'}；
                        法定四键（amount/period/qualityTarget/bondStatus）不可删、type 不可改——完整校验由后端执行，非法形状保存时回报错。
                      </p>
                      {editing.error && <p className="text-xs font-medium text-[var(--danger)]">{editing.error}</p>}
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setEditing(null)} className="neu-btn-soft !h-8 !text-xs">
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={!editing.nameDraft.trim()}
                          className="neu-btn-primary !h-8 !text-xs"
                        >
                          保存模板
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 底部：把配置卡当前字段（含未保存草稿）存为新模板 */}
        <div className="mt-4 rounded-xl bg-[var(--accent-soft)] px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[var(--foreground)]">存为当前项目配置为模板：</span>
            <input
              ref={saveNameRef}
              className="workbench-input !h-8 min-w-[180px] flex-1 !px-2 !text-xs"
              placeholder="模板名称（同类内唯一）"
              value={saveName}
              maxLength={50}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim() && !savingTpl) void handleSaveAsTemplate();
              }}
            />
            <button
              type="button"
              onClick={handleSaveAsTemplate}
              disabled={!saveName.trim() || savingTpl}
              className="neu-btn-xs !h-[30px]"
            >
              {savingTpl ? '保存中…' : '存为模板'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            将配置卡当前 {currentFields.length} 个字段（含未保存的草稿）保存为可复用模板；同名（kind+name）已存在时后端拒绝。
          </p>
        </div>
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
            <button onClick={handleDelete} className="neu-btn-primary is-danger !h-[38px] !text-xs">
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--muted-foreground)]">
          确定要删除模板「{deleteTarget?.name}」吗？此操作不可撤销。
        </p>
      </Modal>
    </>
  );
}
