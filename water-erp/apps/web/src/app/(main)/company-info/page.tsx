'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  Gavel,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { EntryListCard } from '@/components/company/company-entry-list-card';
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

/* EntryListCard 已抽取共享（2026-10-12）：admin 账号管理弹窗内的公司编辑窗口同源复用，
   组件见 @/components/company/company-entry-list-card */
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
        code: data.code ?? '',
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
        code: form.code,
        purchaserAddress: form.purchaserAddress,
      });
      setInfo(saved);
      // 改码联动报告（2026-10-12 方案2）：编码变化时后端同步重写在办项目编号链
      const renamed = saved.codeCascade?.renamed?.length ?? 0;
      const skipped = saved.codeCascade?.skipped?.length ?? 0;
      if (renamed > 0 || skipped > 0) {
        toast.success(`公司信息已保存，已联动更新 ${renamed} 个在办项目编号`);
        if (skipped > 0) {
          toast.warning(`另有 ${skipped} 个在办项目因目标编号被占用未跟随，已保留原编号`);
        }
      } else {
        toast.success('公司信息已保存，后续采购文件与公告编写将按此带入');
      }
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
          公司编码为项目编号首段（编号格式 公司编码-方式前缀-日期序号，全局唯一，大写字母/数字，≤20 字符；留空回退 SW）——修改将同步更新本公司在办项目编号（含阶段码与公告关联码）；归档/回收项目不动，目标编号被占用时该项目保留原编号。
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
              value={form.code ?? ''}
              onChange={(e) => set('code', e.target.value)}
              placeholder="例如：SWHI（留空回退 SW）"
              className="workbench-input w-full font-mono"
              title="项目编号首段（编号格式：公司编码-方式前缀-日期序号，全局唯一）；修改将同步更新本公司在办项目编号，归档/回收项目不动。大写字母/数字，≤20 字符"
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
        hint="可维护多个开标地点、单默认——默认者进入编写时预填「开标地点」字段，编写时可点「地点」按钮改选；不设默认则不预填。"
        fields={[
          { key: 'address', label: '地址（写入文档）', placeholder: '完整地址' },
        ]}
        entries={places}
        onReload={reloadEntries}
        onCreate={async (v) => {
          await createPlace({ address: v.address });
        }}
        onUpdate={async (id, v) => {
          await updatePlace(id, { address: v.address });
        }}
        onSetDefault={async (row, isDefault) => {
          await updatePlace(row.id, { isDefault });
        }}
        onRemove={async (row) => {
          await deletePlace(row.id);
        }}
      />

      {/* ══════ 监督举报条目 ══════ */}
      <EntryListCard
        icon={ShieldAlert}
        title="监督举报"
        hint="可维护多套监督举报信息（以监督人为标识）、单默认——默认者进入编写时预填「监督信息」四字段；不设默认则不预填。"
        fields={[
          { key: 'contact', label: '监督人（标识，必填）', placeholder: '多人顿号分隔，如：王先生、徐先生' },
          { key: 'department', label: '监督部门', placeholder: '留空 = 公司名称 + 纪检监察部' },
          { key: 'address', label: '监督地址', placeholder: '地址' },
          { key: 'phone', label: '监督电话', placeholder: '电话' },
        ]}
        entries={supervisions}
        onReload={reloadEntries}
        onCreate={async (v) => {
          await createSupervision({
            contact: v.contact,
            department: v.department || null,
            address: v.address || null,
            phone: v.phone || null,
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
        onSetDefault={async (row, isDefault) => {
          await updateSupervision(row.id, { isDefault });
        }}
        onRemove={async (row) => {
          await deleteSupervision(row.id);
        }}
      />

      {/* ══════ 采购人条目 ══════ */}
      <EntryListCard
        icon={UserRound}
        title="采购人"
        hint="可维护多位采购人、单默认——默认者进入编写时预填联系人三字段，编写时可点「联系人」按钮改选；不设默认则不预填。"
        fields={[
          { key: 'name', label: '姓名', placeholder: '姓名（必填）' },
          { key: 'phone', label: '联系电话', placeholder: '电话', type: 'tel' },
          { key: 'email', label: '电子邮箱', placeholder: '邮箱', type: 'email' },
        ]}
        entries={purchasers}
        onReload={reloadEntries}
        onCreate={async (v) => {
          await createPurchaser({ name: v.name, phone: v.phone || null, email: v.email || null });
        }}
        onUpdate={async (id, v) => {
          await updatePurchaser(id, { name: v.name, phone: v.phone || null, email: v.email || null });
        }}
        onSetDefault={async (row, isDefault) => {
          await updatePurchaser(row.id, { isDefault });
        }}
        onRemove={async (row) => {
          await deletePurchaser(row.id);
        }}
      />

    </div>
  );
}
