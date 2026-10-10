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
  createPurchaser,
  deletePurchaser,
  fetchMyCompanyInfo,
  updateMyCompanyInfo,
  updatePurchaser,
  type CompanyInfo,
  type CompanyPurchaserEntry,
} from '@/lib/api/company-info';

/* ═══════════════════════════════════════════════════════════════
   公司信息管理（2026-10-10）
   leader 维护本公司基础信息：名称 / 开标地点 / 监督块 / 采购人联系块。
   维护值供采购文件编写与公告编写按登录人公司自动带入
   （监督块+采购人联系人预填草稿；开标地点替换模板默认地址）。
   ═══════════════════════════════════════════════════════════════ */

/** 表单字段布局：[{字段, 标签, 占位, 类型?}]——渲染与提交共用同一份清单 */
const SECTIONS: Array<{
  key: string;
  icon: typeof MapPin;
  title: string;
  hint: string;
  fields: Array<{ key: keyof CompanyInfo; label: string; placeholder: string; type?: string; wide?: boolean }>;
}> = [
  {
    key: 'opening',
    icon: MapPin,
    title: '开标地点',
    hint: '采购文件「递交/开标地点」与公告「开标地点」自动带入此地址；留空沿用模板默认地址。',
    fields: [
      { key: 'bidOpeningAddress', label: '开标地点', placeholder: '例如：四川省成都市双流区红莲街三段383号四川水发集团B座3楼采购中心', wide: true },
    ],
  },
  {
    key: 'supervision',
    icon: ShieldAlert,
    title: '监督信息',
    hint: '公告与采购文件「监督举报」块自动带入；监督部门留空时按「公司名 + 纪检监察部」生成，其余留空沿用平台默认值。',
    fields: [
      { key: 'supervisionDept', label: '监督部门', placeholder: '留空 = 公司名称 + 纪检监察部' },
      { key: 'supervisionPhone', label: '监督电话', placeholder: '例如：028-XXXXXXXX', type: 'tel' },
      { key: 'supervisionAddress', label: '监督地址', placeholder: '例如：四川省成都市双流区红莲街三段383号', wide: true },
      { key: 'supervisionContact', label: '监督人', placeholder: '多人以顿号分隔，例如：王先生、徐先生', wide: true },
    ],
  },
  // 采购人信息节（2026-10-10 多人版）拆为专属卡片：地址随统一保存，
  // 联系人升级为多条目列表（增删改/单默认），见下方 PurchaserCard
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export default function CompanyInfoPage() {
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 采购人条目（2026-10-10 多人版）：列表行内编辑即时保存（走独立 CRUD 端点，不随「保存」）
  const [purchasers, setPurchasers] = useState<CompanyPurchaserEntry[]>([]);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({ name: '', phone: '', email: '' });

  const refreshPurchasers = useCallback(async () => {
    try {
      const data = await fetchMyCompanyInfo();
      setPurchasers(data.purchasers ?? []);
    } catch {
      /* 刷新失败不打断页面，下次操作自然重试 */
    }
  }, []);

  // 行内编辑草稿：随服务端列表同步（保存/刷新后重置为已保存值）
  const [rowDrafts, setRowDrafts] = useState<Record<string, { name: string; phone: string; email: string }>>({});
  useEffect(() => {
    setRowDrafts(
      Object.fromEntries(
        purchasers.map((p) => [p.id, { name: p.name, phone: p.phone ?? '', email: p.email ?? '' }]),
      ),
    );
  }, [purchasers]);

  const addPurchaser = async () => {
    if (!newRow.name.trim()) {
      toast.error('采购人姓名不能为空');
      return;
    }
    setRowBusy('__new__');
    try {
      await createPurchaser({
        name: newRow.name,
        phone: newRow.phone || null,
        email: newRow.email || null,
        // 首条自动设默认（无人维护时预填需要落点）
        isDefault: purchasers.length === 0,
      });
      setNewRow({ name: '', phone: '', email: '' });
      await refreshPurchasers();
      toast.success('采购人已添加');
    } catch (e) {
      toast.error((e as Error).message || '添加失败');
    } finally {
      setRowBusy(null);
    }
  };

  const savePurchaserRow = async (row: CompanyPurchaserEntry, patch: { name?: string; phone?: string | null; email?: string | null }) => {
    setRowBusy(row.id);
    try {
      await updatePurchaser(row.id, patch);
      await refreshPurchasers();
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setRowBusy(null);
    }
  };

  const setRowDefault = async (row: CompanyPurchaserEntry) => {
    if (row.isDefault) return;
    setRowBusy(row.id);
    try {
      await updatePurchaser(row.id, { isDefault: true });
      await refreshPurchasers();
      toast.success(`已设「${row.name}」为默认采购人`);
    } catch (e) {
      toast.error((e as Error).message || '设置失败');
    } finally {
      setRowBusy(null);
    }
  };

  const removePurchaser = async (row: CompanyPurchaserEntry) => {
    setRowBusy(row.id);
    try {
      await deletePurchaser(row.id);
      await refreshPurchasers();
      toast.success('采购人已删除');
    } catch (e) {
      toast.error((e as Error).message || '删除失败');
    } finally {
      setRowBusy(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyCompanyInfo();
      if (!data) throw new Error('所属公司数据异常，请联系管理员处理');
      setInfo(data);
      setPurchasers(data.purchasers ?? []);
      // name/shortName/purchaserAddress 不在 ALL_FIELDS（基本信息节与采购人卡片单独处理），此处一并初始化
      setForm({
        name: data.name ?? '',
        shortName: data.shortName ?? '',
        purchaserAddress: data.purchaserAddress ?? '',
        ...Object.fromEntries(
          ALL_FIELDS.map((k) => [k, ((data as Record<string, unknown>)[k] as string | null) ?? '']),
        ),
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
      const payload = Object.fromEntries(
        ALL_FIELDS.concat('name', 'shortName', 'purchaserAddress').map((k) => [k, form[k] ?? '']),
      );
      const saved = await updateMyCompanyInfo(payload);
      setInfo(saved);
      toast.success('公司信息已保存，后续采购文件与公告编写将按此带入');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

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
                维护本公司的开标地点、监督信息与采购人联系方式——采购文件编写与公告编写将自动带入
              </div>
            </div>
          </div>
          <div className="page-hero__right">
            {/* cgzxui：并排主次按钮用 .neu-btn-group 统一 38px 等高（primary 44px 与他钮
                不齐平是反模式）；!w-auto 覆写组默认 width:100%（hero 右区按内容收窄）。
                disabled 态走类内建样式（:disabled opacity/cursor），无需附加类名 */}
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

      {/* ══════ 基本信息（名称可改，全局唯一） ══════ */}
      <div className="neu-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Gavel size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">基本信息</span>
        </div>
        <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
          公司名称用于采购文件「采购人」落款与公告发布方展示（留空沿用模板默认）；改名即时生效于新项目归属快照。
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
      </div>

      {/* ══════ 开标地点 / 监督信息 ══════ */}
      {SECTIONS.map((section) => (
        <div key={section.key} className="neu-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <section.icon size={14} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">{section.title}</span>
          </div>
          <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">{section.hint}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {section.fields.map((f) => (
              <label key={String(f.key)} className={f.wide ? 'md:col-span-2 block' : 'block'}>
                <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">{f.label}</span>
                <input
                  type={f.type ?? 'text'}
                  value={form[String(f.key)] ?? ''}
                  onChange={(e) => set(String(f.key), e.target.value)}
                  placeholder={f.placeholder}
                  className="workbench-input w-full"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* ══════ 采购人信息（2026-10-10 多人版）：地址随「保存」，联系人为多条目即时维护 ══════ */}
      <div className="neu-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <UserRound size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">采购人信息</span>
        </div>
        <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
          可维护多位采购人（默认者用于进入编写时的预填）；编写采购文件时点「联系人」按钮即可从条目中改选。地址随上方「保存」提交。
        </p>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">采购人地址</span>
          <input
            type="text"
            value={form.purchaserAddress ?? ''}
            onChange={(e) => set('purchaserAddress', e.target.value)}
            placeholder="例如：四川省成都市双流区红莲街三段383号"
            className="workbench-input w-full"
          />
        </label>

        {/* 条目列表：行内编辑即时保存（独立 CRUD），默认单选 */}
        <div className="space-y-2">
          {purchasers.length === 0 && (
            <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-5 text-center text-xs text-[var(--muted-foreground)]">
              暂无采购人条目——未维护时编写页不预填联系人，可先在下方添加
            </div>
          )}
          {purchasers.map((p) => {
            const draft = rowDrafts[p.id] ?? { name: p.name, phone: p.phone ?? '', email: p.email ?? '' };
            const dirty =
              draft.name !== p.name || draft.phone !== (p.phone ?? '') || draft.email !== (p.email ?? '');
            const rowDisabled = rowBusy === p.id;
            return (
              <div
                key={p.id}
                className={`grid grid-cols-1 items-center gap-2 rounded-[12px] border px-3 py-2 md:grid-cols-[auto_1fr_1fr_1fr_auto_auto] ${
                  p.isDefault ? 'border-[rgba(76,111,189,0.45)] bg-[rgba(96,139,239,0.06)]' : 'border-[var(--border)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void setRowDefault(p)}
                  disabled={rowDisabled || p.isDefault}
                  title={p.isDefault ? '当前默认（进入编写时预填此人）' : '设为默认采购人'}
                  className={`neu-btn-xs ${p.isDefault ? 'is-primary' : ''}`}
                >
                  {p.isDefault ? <UserRoundCheck size={13} /> : <UserRound size={13} />}
                  {p.isDefault ? '默认' : '设默认'}
                </button>
                <input
                  type="text"
                  value={draft.name}
                  disabled={rowDisabled}
                  onChange={(e) => setRowDrafts((prev) => ({ ...prev, [p.id]: { ...draft, name: e.target.value } }))}
                  placeholder="姓名"
                  className="workbench-input w-full"
                />
                <input
                  type="tel"
                  value={draft.phone}
                  disabled={rowDisabled}
                  onChange={(e) => setRowDrafts((prev) => ({ ...prev, [p.id]: { ...draft, phone: e.target.value } }))}
                  placeholder="联系电话"
                  className="workbench-input w-full"
                />
                <input
                  type="email"
                  value={draft.email}
                  disabled={rowDisabled}
                  onChange={(e) => setRowDrafts((prev) => ({ ...prev, [p.id]: { ...draft, email: e.target.value } }))}
                  placeholder="电子邮箱"
                  className="workbench-input w-full"
                />
                <button
                  type="button"
                  onClick={() =>
                    void savePurchaserRow(p, {
                      name: draft.name.trim(),
                      phone: draft.phone || null,
                      email: draft.email || null,
                    })
                  }
                  disabled={rowDisabled || !dirty || !draft.name.trim()}
                  className="neu-btn-xs is-primary"
                  title="保存本行修改"
                >
                  {rowDisabled ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => void removePurchaser(p)}
                  disabled={rowDisabled}
                  className="neu-btn-xs is-danger"
                  title="删除采购人"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}

          {/* 新增行 */}
          <div className="grid grid-cols-1 items-center gap-2 rounded-[12px] border border-dashed border-[rgba(96,139,239,0.4)] px-3 py-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <input
              type="text"
              value={newRow.name}
              disabled={rowBusy === '__new__'}
              onChange={(e) => setNewRow((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="姓名（必填）"
              className="workbench-input w-full"
            />
            <input
              type="tel"
              value={newRow.phone}
              disabled={rowBusy === '__new__'}
              onChange={(e) => setNewRow((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="联系电话"
              className="workbench-input w-full"
            />
            <input
              type="email"
              value={newRow.email}
              disabled={rowBusy === '__new__'}
              onChange={(e) => setNewRow((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="电子邮箱"
              className="workbench-input w-full"
            />
            <button
              type="button"
              onClick={() => void addPurchaser()}
              disabled={rowBusy === '__new__' || !newRow.name.trim()}
              className="neu-btn-soft"
            >
              {rowBusy === '__new__' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              添加
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
