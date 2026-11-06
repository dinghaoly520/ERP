'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

/**
 * 通用条目卡（采购人/开标地点/监督举报三处同构）：默认单选（设默认自动取消其他），
 * 首条自动设默认（预填需要落点）；行内编辑即时保存（独立 CRUD）。
 * 2026-11-06 重设计：展示态凸起瓷片行（.ce-row）+ 编辑/新增内凹输入井（.ce-well）——
 * 凸起读、凹陷写；「编辑」进入改写、「添加」按需展开新增表单，替代旧常驻输入行。
 * 共享消费方：leader「公司信息管理」页 + admin 账号管理弹窗内公司编辑窗口。
 */

export type EntryLike = { id: string; isDefault: boolean } & Record<string, string | boolean | null>;

export type EntryCardField = { key: string; label: string; placeholder: string; type?: string };

export function EntryListCard({
  icon: Icon,
  title,
  hint,
  fields,
  entries,
  onReload,
  onCreate,
  onUpdate,
  onSetDefault,
  onRemove,
}: {
  icon: typeof Plus;
  title: string;
  hint: string;
  fields: EntryCardField[];
  entries: EntryLike[];
  onReload: () => Promise<void>;
  onCreate: (values: Record<string, string>) => Promise<void>;
  onUpdate: (id: string, values: Record<string, string>) => Promise<void>;
  onSetDefault: (row: EntryLike, isDefault: boolean) => Promise<void>;
  onRemove: (row: EntryLike) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<Record<string, string>>({});

  // 输入框按字段数等分整行（2026-10-10 用户裁定）：字面量查表保证 Tailwind JIT 可编译；移动端单列
  const evenGridClass =
    fields.length <= 1 ? 'md:grid-cols-1'
    : fields.length === 2 ? 'md:grid-cols-2'
    : fields.length === 3 ? 'md:grid-cols-3'
    : 'md:grid-cols-4';

  useEffect(() => {
    setDrafts((prev) =>
      Object.fromEntries(
        entries.map((e) => [
          e.id,
          // 正在编辑的行保留用户在改的草稿，其余行随服务器回填（避免他行操作刷新冲掉编辑中内容）
          e.id === editingId && prev[e.id]
            ? prev[e.id]
            : Object.fromEntries(fields.map((f) => [f.key, String(e[f.key] ?? '')])),
        ]),
      ),
    );
    if (editingId && !entries.some((e) => e.id === editingId)) setEditingId(null);
    // 字段配置由各卡片静态给定；editingId 仅用于草稿保护判断，均不参与同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const add = async () => {
    const primary = fields[0];
    if (!newRow[primary.key]?.trim()) {
      toast.error(`${primary.label}不能为空`);
      return;
    }
    setBusy('__new__');
    try {
      await onCreate(newRow);
      setNewRow({});
      setAdding(false);
      await onReload();
      toast.success('条目已添加');
    } catch (e) {
      toast.error((e as Error).message || '添加失败');
    } finally {
      setBusy(null);
    }
  };

  /** 行操作统一路径：成功后必须刷新列表——否则设默认后徽标不迁移、
      界面看似未生效；busy 锁行防重复点击，失败就地报错；返回成功与否供调用方收尾 */
  const runRow = async (id: string, action: () => Promise<void>, successMessage?: string) => {
    setBusy(id);
    try {
      await action();
      await onReload();
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error((e as Error).message || '操作失败');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const cancelEdit = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      setDrafts((prev) => ({
        ...prev,
        [id]: Object.fromEntries(fields.map((f) => [f.key, String(entry[f.key] ?? '')])),
      }));
    }
    setEditingId(null);
  };

  return (
    <div className="neu-card p-5">
      {/* 卡头：图标井 + 标题 + 条数 | 添加入口（按需展开，不再常驻虚线行） */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="wb-icon-well wb-icon-well--sm">
            <Icon size={14} strokeWidth={1.7} />
          </span>
          <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
          <span className="font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{entries.length} 条</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setAdding((a) => !a);
            setNewRow({});
          }}
          className="neu-btn-soft !h-9 !text-xs"
        >
          <Plus size={13} strokeWidth={1.8} />
          添加
        </button>
      </div>
      <p className="mb-4 mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">{hint}</p>

      <div className="space-y-2.5">
        {/* 新增输入井 */}
        {adding && (
          <div className="ce-well">
            <div className={`grid grid-cols-1 gap-2 ${evenGridClass}`}>
              {fields.map((f) => (
                <input
                  key={f.key}
                  type={f.type ?? 'text'}
                  value={newRow[f.key] ?? ''}
                  disabled={busy === '__new__'}
                  onChange={(e) => setNewRow((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="workbench-input w-full"
                />
              ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">{fields[0].label}为必填项</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAdding(false); setNewRow({}); }} className="neu-btn-soft !h-8 !text-xs">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={busy === '__new__' || !(newRow[fields[0].key] ?? '').trim()}
                  className="neu-btn-primary !h-8 !text-xs"
                >
                  {busy === '__new__' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  添加
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 空态 */}
        {entries.length === 0 && !adding && (
          <div className="ce-well py-8 text-center">
            <Icon size={26} strokeWidth={1.4} className="mx-auto mb-2 text-[oklch(0.72_0.025_258)]" />
            <p className="text-xs text-[var(--muted-foreground)]">暂无{title}，点击右上角「添加」新建</p>
          </div>
        )}

        {entries.map((entry) => {
          const draft = drafts[entry.id] ?? Object.fromEntries(fields.map((f) => [f.key, String(entry[f.key] ?? '')]));
          const dirty = fields.some((f) => (draft[f.key] ?? '') !== String(entry[f.key] ?? ''));
          const rowDisabled = busy === entry.id;
          const isEditing = editingId === entry.id;
          const primaryValue = String(entry[fields[0].key] ?? '');

          /* 编辑态：整行化为内凹输入井 */
          if (isEditing) {
            return (
              <div key={entry.id} className="ce-well">
                <div className={`grid grid-cols-1 gap-2 ${evenGridClass}`}>
                  {fields.map((f) => (
                    <input
                      key={f.key}
                      type={f.type ?? 'text'}
                      value={draft[f.key] ?? ''}
                      disabled={rowDisabled}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.id]: { ...draft, [f.key]: e.target.value } }))}
                      placeholder={f.placeholder}
                      className="workbench-input w-full"
                    />
                  ))}
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--muted-foreground)]">{fields[0].label}为必填项</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => cancelEdit(entry.id)} disabled={rowDisabled} className="neu-btn-soft !h-8 !text-xs">
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await runRow(entry.id, () => onUpdate(entry.id, draft), '已保存');
                        if (ok) setEditingId(null);
                      }}
                      disabled={rowDisabled || !dirty || !(draft[fields[0].key] ?? '').trim()}
                      className="neu-btn-primary !h-8 !text-xs"
                    >
                      {rowDisabled ? <Loader2 size={13} className="animate-spin" /> : null}
                      保存
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          /* 展示态：凸起瓷片行——状态列（默认徽标独立占位）/ 正文列 / 操作列三区分离，
              徽标不与正文、操作钮挤挨（2026-11-06 用户裁定布局融洽） */
          return (
            <div key={entry.id} className="ce-row">
              <div className="flex w-16 shrink-0 items-center">
                {entry.isDefault && (
                  <button
                    type="button"
                    onClick={() =>
                      void runRow(
                        entry.id,
                        () => onSetDefault(entry, false),
                        `已取消「${primaryValue}」的默认，编写采购文件不再预填此项`,
                      )
                    }
                    disabled={rowDisabled}
                    title="当前默认（点击取消默认；取消后编写不再预填此项）"
                    className="wb-status-pill cursor-pointer"
                  >
                    <span className="wb-status-pill-dot" />
                    默认
                  </button>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">{primaryValue || '（未命名）'}</p>
                {fields.length > 1 && (
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 text-xs text-[var(--muted-foreground)]">
                    {fields.slice(1).map((f) => (
                      <span key={f.key} className="inline-flex items-baseline gap-1.5">
                        <span className="text-[10px] font-medium opacity-80">{f.label}</span>
                        <span className="font-medium text-[oklch(0.42_0.03_258)]">{String(entry[f.key] ?? '') || '—'}</span>
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {rowDisabled ? (
                  <Loader2 size={14} className="animate-spin text-[var(--muted-foreground)]" />
                ) : (
                  <>
                    {!entry.isDefault && (
                      <button
                        type="button"
                        onClick={() => void runRow(entry.id, () => onSetDefault(entry, true), `已设「${primaryValue}」为默认`)}
                        className="neu-btn-xs"
                        title="设为默认（编写采购文件时预填此项）"
                      >
                        设默认
                      </button>
                    )}
                    <button type="button" onClick={() => setEditingId(entry.id)} className="neu-btn-xs" title="编辑本条">
                      <Pencil size={13} strokeWidth={1.7} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void runRow(entry.id, () => onRemove(entry), '已删除')}
                      className="neu-btn-xs is-danger"
                      title="删除条目"
                    >
                      <Trash2 size={13} strokeWidth={1.7} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
