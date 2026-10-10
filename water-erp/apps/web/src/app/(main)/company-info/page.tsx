'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  Gavel,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  UserRound,
  UserRoundCheck,
} from 'lucide-react';
import {
  createPlace,
  createPurchaser,
  createSupervision,
  deletePlace,
  deletePurchaser,
  deleteSupervision,
  fetchMyCompanyInfo,
  updateMyCompanyInfo,
  updatePlace,
  updatePurchaser,
  updateSupervision,
  type CompanyInfo,
  type CompanyPlaceEntry,
  type CompanyPurchaserEntry,
  type CompanySupervisionEntry,
} from '@/lib/api/company-info';

/* ═══════════════════════════════════════════════════════════════
   公司信息管理（2026-10-10，条目化）
   leader 维护：基本信息（名称/简称/采购人地址）+ 三类条目列表——
   采购人 / 开标地点 / 监督举报（均为多条目、单默认）。
   默认条目用于采购文件编写进入预填；编写时可点对应按钮改选其他条目。
   ═══════════════════════════════════════════════════════════════ */

type EntryLike = { id: string; isDefault: boolean } & Record<string, string | boolean | null>;

type EntryCardField = { key: string; label: string; placeholder: string; type?: string };

/**
 * 通用条目卡片（采购人/开标地点/监督举报三处同构）：行内编辑即时保存（独立 CRUD），
 * 默认单选（设默认自动取消其他），首条自动设默认（预填需要落点）。
 */
function EntryListCard({
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
  onCreate: (values: Record<string, string>, firstAutoDefault: boolean) => Promise<void>;
  onUpdate: (id: string, values: Record<string, string>) => Promise<void>;
  onSetDefault: (row: EntryLike) => Promise<void>;
  onRemove: (row: EntryLike) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<Record<string, string>>({});

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
      await onCreate(newRow, entries.length === 0);
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
            暂无条目——未维护时编写页不预填，可先在下方添加
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
                    void runRow(entry.id, () => onSetDefault(entry), `已设「${String(entry[fields[0].key] ?? '')}」为默认`)
                  }
                  disabled={rowDisabled || entry.isDefault}
                  title={entry.isDefault ? '当前默认（进入编写时预填此项）' : '设为默认'}
                  className={`neu-btn-xs shrink-0 ${entry.isDefault ? 'is-primary' : ''}`}
                >
                  {entry.isDefault ? <UserRoundCheck size={13} /> : <UserRound size={13} />}
                  {entry.isDefault ? '默认' : '设默认'}
                </button>
                <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
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

export default function CompanyInfoPage() {
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchasers, setPurchasers] = useState<CompanyPurchaserEntry[]>([]);
  const [places, setPlaces] = useState<CompanyPlaceEntry[]>([]);
  const [supervisions, setSupervisions] = useState<CompanySupervisionEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyCompanyInfo();
      if (!data) throw new Error('所属公司数据异常，请联系管理员处理');
      setInfo(data);
      setPurchasers(data.purchasers ?? []);
      setPlaces(data.places ?? []);
      setSupervisions(data.supervisionProfiles ?? []);
      setForm({
        name: data.name ?? '',
        shortName: data.shortName ?? '',
        purchaserAddress: data.purchaserAddress ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!info) return;
    if (!form.name.trim()) {
      toast.error('公司名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const saved = await updateMyCompanyInfo({
        name: form.name,
        shortName: form.shortName,
        purchaserAddress: form.purchaserAddress,
      });
      setInfo(saved);
      toast.success('公司信息已保存，后续采购文件与公告编写将按此带入');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const reloadEntries = useCallback(async () => {
    try {
      const data = await fetchMyCompanyInfo();
      setPurchasers(data.purchasers ?? []);
      setPlaces(data.places ?? []);
      setSupervisions(data.supervisionProfiles ?? []);
    } catch {
      /* 刷新失败不打断页面，下次操作自然重试 */
    }
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="inline-flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />
          正在加载公司信息...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="neu-card p-6 text-center">
        <ShieldAlert size={22} className="mx-auto mb-2 text-[var(--warning)]" />
        <div className="text-sm font-medium text-[var(--foreground)]">{error}</div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">
          请联系管理员（账号管理 → 公司信息管理）为账号归属公司后再维护
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon">
              <Building2 size={17} />
            </div>
            <div>
              <div className="page-hero__title">公司信息管理</div>
              <div className="page-hero__sub">
                维护本公司的开标地点、监督举报与采购人条目——采购文件编写自动带入默认条目，编写时可改选
              </div>
            </div>
          </div>
          <div className="page-hero__right">
            <div className="neu-btn-group !w-auto">
              <button type="button" onClick={() => void load()} className="neu-btn-soft" title="重新加载本公司信息">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
              <button type="button" onClick={() => void save()} disabled={saving} className="neu-btn-primary">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
        <div className="page-hero__divider" />
      </div>

      {/* ══════ 基本信息（名称可改，全局唯一；采购人地址随「保存」） ══════ */}
      <div className="neu-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Gavel size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">基本信息</span>
        </div>
        <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
          公司名称用于采购文件「采购人」落款与公告发布方展示（留空沿用模板默认）；采购人地址预填「联系人地址」字段。改名即时生效于新项目归属快照。
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              公司名称 <span className="text-[var(--danger)]">*</span>
            </span>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              placeholder="规范全称（全局唯一）"
              className="workbench-input w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">公司简称</span>
            <input
              type="text"
              value={form.shortName ?? ''}
              onChange={(e) => set('shortName', e.target.value)}
              placeholder="例如：设计公司"
              className="workbench-input w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">公司编码</span>
            <input
              type="text"
              value={info?.code ?? ''}
              disabled
              placeholder="—"
              className="workbench-input w-full font-mono disabled:opacity-60"
              title="公司编码（项目编号前缀段）由主数据维护，此处只读"
            />
          </label>
        </div>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">采购人地址（随「保存」提交）</span>
          <input
            type="text"
            value={form.purchaserAddress ?? ''}
            onChange={(e) => set('purchaserAddress', e.target.value)}
            placeholder="例如：四川省成都市双流区红莲街三段383号"
            className="workbench-input w-full"
          />
        </label>
      </div>

      {/* ══════ 开标地点条目 ══════ */}
      <EntryListCard
        icon={MapPin}
        title="开标地点"
        hint="可维护多个开标地点、单默认——默认者进入编写时预填「开标地点」字段，编写时可点「地点」按钮改选。"
        fields={[
          { key: 'address', label: '地址（写入文档）', placeholder: '完整地址' },
        ]}
        entries={places}
        onReload={reloadEntries}
        onCreate={async (v, firstDefault) => {
          await createPlace({ address: v.address, isDefault: firstDefault });
        }}
        onUpdate={async (id, v) => {
          await updatePlace(id, { address: v.address });
        }}
        onSetDefault={async (row) => {
          await updatePlace(row.id, { isDefault: true });
        }}
        onRemove={async (row) => {
          await deletePlace(row.id);
        }}
      />

      {/* ══════ 监督举报条目 ══════ */}
      <EntryListCard
        icon={ShieldAlert}
        title="监督举报"
        hint="可维护多套监督举报信息（以监督人为标识）、单默认——默认者进入编写时预填「监督信息」四字段，编写时可点「监督举报」按钮改选整块。"
        fields={[
          { key: 'contact', label: '监督人（标识，必填）', placeholder: '多人顿号分隔，如：王先生、徐先生' },
          { key: 'department', label: '监督部门', placeholder: '留空 = 公司名称 + 纪检监察部' },
          { key: 'address', label: '监督地址', placeholder: '地址' },
          { key: 'phone', label: '监督电话', placeholder: '电话' },
        ]}
        entries={supervisions}
        onReload={reloadEntries}
        onCreate={async (v, firstDefault) => {
          await createSupervision({
            contact: v.contact,
            department: v.department || null,
            address: v.address || null,
            phone: v.phone || null,
            isDefault: firstDefault,
          });
        }}
        onUpdate={async (id, v) => {
          await updateSupervision(id, {
            contact: v.contact,
            department: v.department || null,
            address: v.address || null,
            phone: v.phone || null,
          });
        }}
        onSetDefault={async (row) => {
          await updateSupervision(row.id, { isDefault: true });
        }}
        onRemove={async (row) => {
          await deleteSupervision(row.id);
        }}
      />

      {/* ══════ 采购人条目 ══════ */}
      <EntryListCard
        icon={UserRound}
        title="采购人"
        hint="可维护多位采购人、单默认——默认者进入编写时预填联系人三字段，编写时可点「联系人」按钮改选。"
        fields={[
          { key: 'name', label: '姓名', placeholder: '姓名（必填）' },
          { key: 'phone', label: '联系电话', placeholder: '电话', type: 'tel' },
          { key: 'email', label: '电子邮箱', placeholder: '邮箱', type: 'email' },
        ]}
        entries={purchasers}
        onReload={reloadEntries}
        onCreate={async (v, firstDefault) => {
          await createPurchaser({ name: v.name, phone: v.phone || null, email: v.email || null, isDefault: firstDefault });
        }}
        onUpdate={async (id, v) => {
          await updatePurchaser(id, { name: v.name, phone: v.phone || null, email: v.email || null });
        }}
        onSetDefault={async (row) => {
          await updatePurchaser(row.id, { isDefault: true });
        }}
        onRemove={async (row) => {
          await deletePurchaser(row.id);
        }}
      />

    </div>
  );
}
