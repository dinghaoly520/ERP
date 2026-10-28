'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MapPin, Plus, Save, Trash2, UserRound, UserRoundCheck } from 'lucide-react';

/**
 * 通用条目卡片（采购人/开标地点/监督举报三处同构）：行内编辑即时保存（独立 CRUD），
 * 默认单选（设默认自动取消其他），首条自动设默认（预填需要落点）。
 * 2026-10-12 抽取共享：leader「公司信息管理」页与 admin 账号管理弹窗内的公司编辑窗口同源复用。
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
  icon: typeof MapPin;
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
  const [busy, setBusy] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<Record<string, string>>({});

  // 输入框按字段数等分整行（2026-10-10 用户裁定）：字面量查表保证 Tailwind JIT 可编译；移动端单列
  const evenGridClass =
    fields.length <= 1 ? 'md:grid-cols-1'
    : fields.length === 2 ? 'md:grid-cols-2'
    : fields.length === 3 ? 'md:grid-cols-3'
    : 'md:grid-cols-4';

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        entries.map((e) => [
          e.id,
          Object.fromEntries(fields.map((f) => [f.key, String(e[f.key] ?? '')])),
        ]),
      ),
    );
    // 字段配置由各卡片静态给定，不参与同步
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
      await onReload();
      toast.success('条目已添加');
    } catch (e) {
      toast.error((e as Error).message || '添加失败');
    } finally {
      setBusy(null);
    }
  };

  /** 行操作统一路径（2026-10-10 修复）：成功后必须刷新列表——否则设默认后徽标不迁移、
      界面看似未生效；busy 锁行防重复点击，失败就地报错 */
  const runRow = async (id: string, action: () => Promise<void>, successMessage?: string) => {
    setBusy(id);
    try {
      await action();
      await onReload();
      if (successMessage) toast.success(successMessage);
    } catch (e) {
      toast.error((e as Error).message || '操作失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="neu-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={14} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
      </div>
      <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">{hint}</p>

      <div className="space-y-2">
        {entries.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-5 text-center text-xs text-[var(--muted-foreground)]">
            暂无条目，可先在下方添加
          </div>
        )}
        {entries.map((entry) => {
          const draft = drafts[entry.id] ?? Object.fromEntries(fields.map((f) => [f.key, String(entry[f.key] ?? '')]));
          const dirty = fields.some((f) => (draft[f.key] ?? '') !== String(entry[f.key] ?? ''));
          const rowDisabled = busy === entry.id;
          return (
            <div
              key={entry.id}
              className={`grid grid-cols-1 items-center gap-2 rounded-[12px] border px-3 py-2 md:grid-cols-[auto_1fr_auto_auto] ${
                entry.isDefault
                  ? 'border-[rgba(76,111,189,0.45)] bg-[rgba(96,139,239,0.06)]'
                  : 'border-[var(--border)]'
              }`}
            >
              <div className="flex items-center gap-1.5 md:col-span-3">
                <button
                  type="button"
                  onClick={() =>
                    void runRow(
                      entry.id,
                      () => onSetDefault(entry, !entry.isDefault),
                      entry.isDefault
                        ? `已取消「${String(entry[fields[0].key] ?? '')}」的默认`
                        : `已设「${String(entry[fields[0].key] ?? '')}」为默认`,
                    )
                  }
                  disabled={rowDisabled}
                  title={entry.isDefault ? '当前默认（点击取消默认；取消后编写不再预填此项）' : '设为默认'}
                  className={`neu-btn-xs shrink-0 ${entry.isDefault ? 'is-primary' : ''}`}
                >
                  {entry.isDefault ? <UserRoundCheck size={13} /> : <UserRound size={13} />}
                  {entry.isDefault ? '默认' : '设默认'}
                </button>
                <div className={`grid flex-1 grid-cols-1 gap-2 ${evenGridClass}`}>
                  {fields.map((f) => (
                    <input
                      key={f.key}
                      type={f.type ?? 'text'}
                      value={draft[f.key] ?? ''}
                      disabled={rowDisabled}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.id]: { ...draft, [f.key]: e.target.value } }))}
                      placeholder={f.label}
                      className="workbench-input w-full"
                      title={f.label}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => void runRow(entry.id, () => onUpdate(entry.id, draft), '已保存')}
                  disabled={rowDisabled || !dirty || !(draft[fields[0].key] ?? '').trim()}
                  className="neu-btn-xs is-primary"
                  title="保存本行修改"
                >
                  {rowDisabled ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => void runRow(entry.id, () => onRemove(entry), '已删除')}
                  disabled={rowDisabled}
                  className="neu-btn-xs is-danger"
                  title="删除条目"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}

        {/* 新增行 */}
        <div className="grid grid-cols-1 items-center gap-2 rounded-[12px] border border-dashed border-[rgba(96,139,239,0.4)] px-3 py-2 md:grid-cols-[1fr_auto]">
          <div className={`grid grid-cols-1 gap-2 ${evenGridClass}`}>
            {fields.map((f) => (
              <input
                key={f.key}
                type={f.type ?? 'text'}
                value={newRow[f.key] ?? ''}
                disabled={busy === '__new__'}
                onChange={(e) => setNewRow((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={`${f.label}${f.key === fields[0].key ? '（必填）' : ''}`}
                className="workbench-input w-full"
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy === '__new__' || !(newRow[fields[0].key] ?? '').trim()}
            className="neu-btn-soft justify-self-end"
          >
            {busy === '__new__' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
